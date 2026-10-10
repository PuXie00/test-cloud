import type { AiStatusKind } from '../../shared/ai-bridge/types'
import {
  axisStatusLabel,
  classifyAxisStatus,
  classifyModelStatus,
  modelStatusLabel,
} from '../../src/app/pages/console/components/monitor-grid/monitor-status'
import type { AiBridgeStore } from './store'

export const CONFIG_SECTIONS = ['meta', 'setup', 'motion', 'rules'] as const
export type ConfigSection = (typeof CONFIG_SECTIONS)[number]

export const STATUS_KINDS: readonly AiStatusKind[] = ['plcs', 'objects', 'motors', 'actions']

export type ConfigQuery = {
  /** null = 默认全部业务分区 */
  sections: ConfigSection[] | null
  /** 原样返回整份文档（含 view / snapshots / meta.wizard） */
  full: boolean
}

export type StatusQuery = {
  /** null = 全部种类 */
  kinds: AiStatusKind[] | null
  /** 每类只返回这些 id；缺省不过滤 */
  ids: Partial<Record<AiStatusKind, Set<number>>>
}

const OFFLINE_LABEL = '离线'

const ACTION_STATE_LABEL: Record<number, string> = {
  1: '过渡（回迹中）',
  3: '运行中',
}

type Entity = { id: number } & Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readEntities = (value: unknown): Entity[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Entity =>
          isRecord(item) && typeof item.id === 'number' && Number.isFinite(item.id),
      )
    : []

const withoutKeys = (source: object, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value
  }
  return out
}

const header = (store: AiBridgeStore, resource: 'view' | 'config' | 'status') => ({
  version: store.version(resource),
  updatedAt: store.updated(resource),
})

export const buildViewBody = (store: AiBridgeStore) => ({
  ...header(store, 'view'),
  rendererConnected: store.rendererConnected,
  page: store.page?.page ?? null,
  path: store.page?.path ?? null,
  ruleId: store.page?.ruleId ?? null,
  project: store.page?.project ?? null,
  console: store.console,
})

export const buildConfigBody = (store: AiBridgeStore, query: ConfigQuery) => {
  const config = store.config
  if (!config) return { ...header(store, 'config'), revision: null, dirty: false, config: null }

  const document = config.document
  if (query.full) {
    return { ...header(store, 'config'), revision: config.revision, dirty: config.dirty, config: document }
  }

  const picked: Record<string, unknown> = { schemaVersion: document.schemaVersion }
  for (const section of query.sections ?? CONFIG_SECTIONS) {
    picked[section] = section === 'meta' ? withoutKeys(document.meta, ['wizard']) : document[section]
  }
  return { ...header(store, 'config'), revision: config.revision, dirty: config.dirty, config: picked }
}

/** 配置里的实体在前（含离线），只在实时数据里出现的 id 追加在后 */
const joinById = <Live, Out>(
  configured: readonly Entity[],
  live: ReadonlyMap<number, Live>,
  filter: Set<number> | undefined,
  build: (id: number, entity: Entity | undefined, item: Live | undefined) => Out,
): Out[] => {
  const out: Out[] = []
  const seen = new Set<number>()
  for (const entity of configured) {
    seen.add(entity.id)
    if (filter && !filter.has(entity.id)) continue
    out.push(build(entity.id, entity, live.get(entity.id)))
  }
  for (const [id, item] of live) {
    if (seen.has(id) || (filter && !filter.has(id))) continue
    out.push(build(id, undefined, item))
  }
  return out
}

export const buildStatusBody = (store: AiBridgeStore, query: StatusQuery) => {
  const { live } = store
  const setup: Record<string, unknown> = store.config?.document.setup ?? {}
  const names = store.config?.names
  const nameOf = (
    table: Record<string, string> | undefined,
    id: number,
    entity: Entity | undefined,
  ): string | null =>
    table?.[String(id)] ?? (typeof entity?.name === 'string' ? entity.name : null)
  const wants = (kind: AiStatusKind) => !query.kinds || query.kinds.includes(kind)

  const body: Record<string, unknown> = {
    ...header(store, 'status'),
    connection: live.connection,
  }

  if (wants('plcs')) {
    body.plcs = joinById(readEntities(setup.plcs), live.plcs, query.ids.plcs, (id, entity, item) => ({
      id,
      name: nameOf(names?.plcs, id, entity),
      ip: typeof entity?.ip === 'string' ? entity.ip : null,
      live: item !== undefined,
      ...(item ? withoutKeys(item, ['deviceId']) : {}),
    }))
  }

  if (wants('objects')) {
    body.objects = joinById(
      readEntities(setup.controlledObjects),
      live.objects,
      query.ids.objects,
      (id, entity, item) => {
        const code = item?.modelStatus
        return {
          id,
          name: nameOf(names?.objects, id, entity),
          parentId: typeof entity?.parentId === 'number' ? entity.parentId : null,
          live: item !== undefined,
          status: code === undefined ? 'offline' : classifyModelStatus(code),
          statusLabel: code === undefined ? OFFLINE_LABEL : modelStatusLabel(code),
          ...(item ? withoutKeys(item, ['deviceId']) : {}),
        }
      },
    )
  }

  if (wants('motors')) {
    body.motors = joinById(readEntities(setup.motors), live.motors, query.ids.motors, (id, entity, item) => {
      const code = item?.axisStatus
      return {
        id,
        name: nameOf(names?.motors, id, entity),
        plcId: typeof entity?.plcId === 'number' ? entity.plcId : null,
        objectId: typeof entity?.controlledObjectId === 'number' ? entity.controlledObjectId : null,
        live: item !== undefined,
        status: code === undefined ? 'offline' : classifyAxisStatus(code),
        statusLabel: code === undefined ? OFFLINE_LABEL : axisStatusLabel(code),
        ...(item ? withoutKeys(item, ['deviceId']) : {}),
      }
    })
  }

  if (wants('actions')) {
    const filter = query.ids.actions
    const actions: Record<string, unknown>[] = []
    for (const item of live.actions.values()) {
      if (filter && !filter.has(item.actionId)) continue
      actions.push({
        // 下发时 actionId 就是序列 id
        sequenceId: item.actionId,
        name: names?.sequences[String(item.actionId)] ?? null,
        state: item.state,
        stateLabel: ACTION_STATE_LABEL[item.state] ?? `状态 ${item.state}`,
        loopCount: item.loopCount,
        loopCountSet: item.loopCountSet,
        runTime: item.runTime,
      })
    }
    body.actions = actions
  }

  return body
}
