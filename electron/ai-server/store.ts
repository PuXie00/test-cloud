import type { PlcMasterStatus } from '../../shared/csocket/plc-master-status'
import type { ModelInfo } from '../../shared/csocket/model-info'
import type { AxisInfo } from '../../shared/csocket/axis-info'
import type {
  AiActionLive,
  AiConfigPayload,
  AiConnectionState,
  AiConsoleView,
  AiPageView,
  AiRendererMessage,
  AiStatusDelta,
} from '../../shared/ai-bridge/types'

export type AiResource = 'view' | 'config' | 'status'

export type AiLiveStatus = {
  connection: AiConnectionState
  plcs: Map<number, PlcMasterStatus>
  objects: Map<number, ModelInfo>
  motors: Map<number, AxisInfo>
  actions: Map<number, AiActionLive>
}

/**
 * 子进程内存快照：渲染进程与 main 推送变化，HTTP 只读这里。
 * 每类资源一个递增 version，供响应缓存与 ETag 使用。
 */
export class AiBridgeStore {
  page: AiPageView | null = null
  console: AiConsoleView | null = null
  config: AiConfigPayload | null = null
  rendererConnected = false
  readonly live: AiLiveStatus = {
    connection: 'idle',
    plcs: new Map(),
    objects: new Map(),
    motors: new Map(),
    actions: new Map(),
  }

  private readonly versions: Record<AiResource, number> = { view: 0, config: 0, status: 0 }
  private readonly updatedAt: Record<AiResource, number> = { view: 0, config: 0, status: 0 }

  constructor(private readonly now: () => number = Date.now) {}

  version(resource: AiResource): number {
    return this.versions[resource]
  }

  updated(resource: AiResource): number {
    return this.updatedAt[resource]
  }

  applyRenderer(message: AiRendererMessage): void {
    switch (message?.type) {
      case 'page':
        this.page = message.data
        this.bump('view')
        return
      case 'console':
        this.console = message.data
        this.bump('view')
        return
      case 'config':
        this.config = message.data
        this.bump('config')
        // 状态响应用配置补名称
        this.bump('status')
        return
    }
  }

  /** 换了渲染进程（刷新 / 子进程重启）：旧界面数据作废，等新端口重推 */
  resetRenderer(): void {
    this.page = null
    this.console = null
    this.config = null
    this.bump('view')
    this.bump('config')
    this.bump('status')
  }

  applyStatus(delta: AiStatusDelta): void {
    const live = this.live
    let changed = false

    if (delta.reset) {
      live.plcs.clear()
      live.objects.clear()
      live.motors.clear()
      live.actions.clear()
      changed = true
    }
    if (delta.connection && delta.connection !== live.connection) {
      live.connection = delta.connection
      changed = true
    }
    for (const kind of delta.clear ?? []) {
      const map = live[kind]
      if (map.size === 0) continue
      map.clear()
      changed = true
    }

    const upsert = delta.upsert
    if (upsert?.plcs) {
      live.plcs = new Map(upsert.plcs.map((item) => [item.deviceId, item]))
      changed = true
    }
    for (const item of upsert?.objects ?? []) {
      live.objects.set(item.deviceId, item)
      changed = true
    }
    for (const item of upsert?.motors ?? []) {
      live.motors.set(item.deviceId, item)
      changed = true
    }
    for (const item of upsert?.actions ?? []) {
      live.actions.set(item.actionId, item)
      changed = true
    }
    for (const id of delta.remove?.actions ?? []) {
      if (live.actions.delete(id)) changed = true
    }

    if (changed) this.bump('status')
  }

  private bump(resource: AiResource): void {
    this.versions[resource] += 1
    this.updatedAt[resource] = this.now()
  }
}
