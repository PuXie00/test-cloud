import { isCppAckOk } from '../../../shared/csocket/ack'
import type { PlcMasterStatus } from '../../../shared/csocket/plc-master-status'
import type { ModelInfo } from '../../../shared/csocket/model-info'
import type { AxisInfo } from '../../../shared/csocket/axis-info'
import { AI_ACTION_STALE_MS, AI_STATUS_FLUSH_MS } from '../../../shared/ai-bridge/protocol'
import type {
  AiActionLive,
  AiConnectionState,
  AiStatusDelta,
  AiStatusKind,
} from '../../../shared/ai-bridge/types'

export type AiStatusForwarderOptions = {
  flushMs?: number
  actionStaleMs?: number
  now?: () => number
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const parseActionLive = (result: unknown): AiActionLive[] => {
  if (!isCppAckOk(result) || !Array.isArray(result.data)) return []
  const out: AiActionLive[] = []
  for (const raw of result.data) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (!isFiniteNumber(item.actionId) || !isFiniteNumber(item.state)) continue
    out.push({
      actionId: item.actionId,
      state: item.state,
      loopCount: isFiniteNumber(item.loopCount) ? item.loopCount : 0,
      loopCountSet: isFiniteNumber(item.loopCountSet) ? item.loopCountSet : 0,
      runTime: isFiniteNumber(item.runTime) ? item.runTime : 0,
    })
  }
  return out
}

/**
 * main 侧设备状态镜像：cSocket 来的变化按 flushMs 合并成增量推给子进程，
 * 子进程重启时用 snapshot() 全量同步。PLC 不通知动作结束，超过 actionStaleMs 未上报即移除。
 */
export class AiStatusForwarder {
  private connection: AiConnectionState = 'idle'
  private plcs: PlcMasterStatus[] = []
  private readonly objects = new Map<number, ModelInfo>()
  private readonly motors = new Map<number, AxisInfo>()
  private readonly actions = new Map<number, { item: AiActionLive; seenAt: number }>()

  private pendingConnection = false
  private pendingPlcs = false
  private readonly pendingObjects = new Set<number>()
  private readonly pendingMotors = new Set<number>()
  private readonly pendingActions = new Set<number>()
  private readonly pendingClear = new Set<AiStatusKind>()
  private timer: ReturnType<typeof setTimeout> | null = null

  private readonly flushMs: number
  private readonly actionStaleMs: number
  private readonly now: () => number

  constructor(
    private readonly send: (delta: AiStatusDelta) => void,
    options: AiStatusForwarderOptions = {},
  ) {
    this.flushMs = options.flushMs ?? AI_STATUS_FLUSH_MS
    this.actionStaleMs = options.actionStaleMs ?? AI_ACTION_STALE_MS
    this.now = options.now ?? Date.now
  }

  setConnection(state: AiConnectionState): void {
    if (state === this.connection) return
    this.connection = state
    this.pendingConnection = true
    this.schedule()
  }

  setPlcs(snapshot: PlcMasterStatus[]): void {
    this.plcs = snapshot
    this.pendingPlcs = true
    this.schedule()
  }

  upsertObjects(items: readonly ModelInfo[]): void {
    for (const item of items) {
      this.objects.set(item.deviceId, item)
      this.pendingObjects.add(item.deviceId)
    }
    if (items.length) this.schedule()
  }

  upsertMotors(items: readonly AxisInfo[]): void {
    for (const item of items) {
      this.motors.set(item.deviceId, item)
      this.pendingMotors.add(item.deviceId)
    }
    if (items.length) this.schedule()
  }

  ingestActions(result: unknown): void {
    const items = parseActionLive(result)
    if (!items.length) return
    const seenAt = this.now()
    for (const item of items) {
      this.actions.set(item.actionId, { item, seenAt })
      this.pendingActions.add(item.actionId)
    }
    this.schedule()
  }

  clear(kind: AiStatusKind): void {
    switch (kind) {
      case 'plcs':
        this.plcs = []
        this.pendingPlcs = false
        break
      case 'objects':
        this.objects.clear()
        this.pendingObjects.clear()
        break
      case 'motors':
        this.motors.clear()
        this.pendingMotors.clear()
        break
      case 'actions':
        this.actions.clear()
        this.pendingActions.clear()
        break
    }
    this.pendingClear.add(kind)
    this.schedule()
  }

  /** 全量同步：子进程（重新）起来后发一次 */
  snapshot(): AiStatusDelta {
    return {
      reset: true,
      connection: this.connection,
      upsert: {
        plcs: this.plcs,
        objects: [...this.objects.values()],
        motors: [...this.motors.values()],
        actions: [...this.actions.values()].map((entry) => entry.item),
      },
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  flush(): void {
    this.timer = null
    const removedActions = this.expireActions()
    const delta: AiStatusDelta = {}

    if (this.pendingConnection) delta.connection = this.connection
    if (this.pendingClear.size) delta.clear = [...this.pendingClear]

    const upsert: NonNullable<AiStatusDelta['upsert']> = {}
    if (this.pendingPlcs) upsert.plcs = this.plcs
    if (this.pendingObjects.size) upsert.objects = this.pick(this.objects, this.pendingObjects)
    if (this.pendingMotors.size) upsert.motors = this.pick(this.motors, this.pendingMotors)
    if (this.pendingActions.size) {
      const actions: AiActionLive[] = []
      for (const id of this.pendingActions) {
        const entry = this.actions.get(id)
        if (entry) actions.push(entry.item)
      }
      if (actions.length) upsert.actions = actions
    }
    if (Object.keys(upsert).length) delta.upsert = upsert
    if (removedActions.length) delta.remove = { actions: removedActions }

    this.pendingConnection = false
    this.pendingPlcs = false
    this.pendingObjects.clear()
    this.pendingMotors.clear()
    this.pendingActions.clear()
    this.pendingClear.clear()

    if (Object.keys(delta).length) this.send(delta)
    // 还有动作在跑：继续定时检查过期
    if (this.actions.size) this.schedule()
  }

  private pick<T>(source: ReadonlyMap<number, T>, ids: ReadonlySet<number>): T[] {
    const out: T[] = []
    for (const id of ids) {
      const item = source.get(id)
      if (item) out.push(item)
    }
    return out
  }

  private expireActions(): number[] {
    const now = this.now()
    const removed: number[] = []
    for (const [id, entry] of this.actions) {
      if (now - entry.seenAt <= this.actionStaleMs) continue
      this.actions.delete(id)
      this.pendingActions.delete(id)
      removed.push(id)
    }
    return removed
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.flushMs)
  }
}
