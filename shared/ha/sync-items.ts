/**
 * 工程按项同步（方案 3.1、5.1）：一台 PLC、电机、物体（对齐记录跟着物体）、场景分组、点动参数、
 * 一条序列、节目单、一条规则、工程信息各是一项。主机、备机都用这里的拆分、比对、合并，结果一致。
 * 模型文件、封面不在这里（按文件传）。
 */
import type { HaSyncScope } from './types'

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordOf = (value: unknown): Json => (isRecord(value) ? value : {})

const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** 带 id 的数组项：key 前缀 → 所在部分、字段 */
const LIST_KINDS = [
  { prefix: 'setup:plc:', part: 'setup', field: 'plcs' },
  { prefix: 'setup:motor:', part: 'setup', field: 'motors' },
  { prefix: 'setup:object:', part: 'setup', field: 'controlledObjects' },
  { prefix: 'motion:sequence:', part: 'motion', field: 'actionSequences' },
  { prefix: 'rules:rule:', part: 'rules', field: 'rules' },
] as const

const SCENE_KEY = 'setup:scene'
const MANUAL_JOG_KEY = 'setup:manualJog'
const PROGRAMS_KEY = 'motion:programs'
const META_KEY = 'meta'

/** 工程信息里同步的字段；id、名称、创建 / 修改时间不同步 */
const META_FIELDS = ['author', 'status', 'note', 'tags', 'wizard'] as const

export type HaSyncItems = Map<string, unknown>

export type HaSyncChange = {
  /** 新增或修改的项：key → 内容 */
  put: Record<string, unknown>
  /** 删除的项 */
  del: string[]
}

/** 物体项 = 物体配置 + 它的对齐记录 */
export type HaObjectItem = { object: unknown; alignment: unknown | null }

const inScope = (key: string, scope: HaSyncScope): boolean => {
  if (key.startsWith('setup:')) return true
  if (key.startsWith('motion:')) return scope.motion
  if (key.startsWith('rules:')) return scope.rules
  if (key === META_KEY) return scope.meta
  return false
}

const idOf = (item: unknown): string | null => {
  const id = recordOf(item).id
  return typeof id === 'number' || (typeof id === 'string' && id.length > 0) ? String(id) : null
}

/** 拆成项；范围外的部分不拆 */
export const extractSyncItems = (document: unknown, scope: HaSyncScope): HaSyncItems => {
  const doc = recordOf(document)
  const setup = recordOf(doc.setup)
  const motion = recordOf(doc.motion)
  const rules = recordOf(doc.rules)
  const alignment = recordOf(setup.alignment)
  const items: HaSyncItems = new Map()

  for (const plc of arrayOf(setup.plcs)) {
    const id = idOf(plc)
    if (id) items.set(`setup:plc:${id}`, plc)
  }
  for (const motor of arrayOf(setup.motors)) {
    const id = idOf(motor)
    if (id) items.set(`setup:motor:${id}`, motor)
  }
  for (const object of arrayOf(setup.controlledObjects)) {
    const id = idOf(object)
    if (!id) continue
    const value: HaObjectItem = { object, alignment: alignment[id] ?? null }
    items.set(`setup:object:${id}`, value)
  }
  items.set(SCENE_KEY, setup.scene ?? null)
  items.set(MANUAL_JOG_KEY, setup.manualJog ?? null)

  if (scope.motion) {
    for (const sequence of arrayOf(motion.actionSequences)) {
      const id = idOf(sequence)
      if (id) items.set(`motion:sequence:${id}`, sequence)
    }
    items.set(PROGRAMS_KEY, arrayOf(motion.programs))
  }
  if (scope.rules) {
    for (const rule of arrayOf(rules.rules)) {
      const id = idOf(rule)
      if (id) items.set(`rules:rule:${id}`, rule)
    }
  }
  if (scope.meta) {
    const meta = recordOf(doc.meta)
    const value: Json = {}
    for (const field of META_FIELDS) {
      if (meta[field] !== undefined) value[field] = meta[field]
    }
    items.set(META_KEY, value)
  }
  return items
}

/** 键排序后的 JSON，两台算出来一样；摘要和比对用 */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  const record = value as Json
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

const sameItem = (a: unknown, b: unknown): boolean => a === b || canonicalJson(a) === canonicalJson(b)

/** 改了哪几项：同一份文档改出来的，没改的项还是同一个对象，比引用就够；引用不同再比内容 */
export const diffSyncItems = (before: HaSyncItems, after: HaSyncItems): HaSyncChange => {
  const put: Record<string, unknown> = {}
  const del: string[] = []
  for (const [key, value] of after) {
    if (!before.has(key) || !sameItem(before.get(key), value)) put[key] = value
  }
  for (const key of before.keys()) {
    if (!after.has(key)) del.push(key)
  }
  return { put, del }
}

export const isEmptySyncChange = (change: HaSyncChange): boolean =>
  change.del.length === 0 && Object.keys(change.put).length === 0

/** 两台对一份同步范围算的摘要内容：项按 key 排序 */
export const syncDigestSource = (items: HaSyncItems): string =>
  canonicalJson(
    [...items.keys()].sort().map((key) => [key, items.get(key) ?? null]),
  )

/** 只留范围内的项（范围变小时，对方发来的范围外的项不应用） */
export const filterSyncChange = (change: HaSyncChange, scope: HaSyncScope): HaSyncChange => ({
  put: Object.fromEntries(Object.entries(change.put).filter(([key]) => inScope(key, scope))),
  del: change.del.filter((key) => inScope(key, scope)),
})

const replaceList = (list: unknown[], prefix: string, change: HaSyncChange): unknown[] => {
  const removed = new Set(change.del.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)))
  const puts = new Map<string, unknown>()
  for (const [key, value] of Object.entries(change.put)) {
    if (!key.startsWith(prefix)) continue
    const item = prefix === 'setup:object:' ? (value as HaObjectItem).object : value
    puts.set(key.slice(prefix.length), item)
  }
  if (removed.size === 0 && puts.size === 0) return list
  const next: unknown[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = idOf(item)
    if (id === null) {
      next.push(item)
      continue
    }
    seen.add(id)
    if (removed.has(id)) continue
    next.push(puts.has(id) ? puts.get(id) : item)
  }
  // 新增的接在后面：主机、备机都按收到的顺序追加，顺序一致
  for (const [id, item] of puts) {
    if (!seen.has(id)) next.push(item)
  }
  return next
}

/** 把一批项合进文档，返回新文档（不改原文档）；没变的部分保持原对象 */
export const applySyncChange = <T>(document: T, change: HaSyncChange): T => {
  if (isEmptySyncChange(change)) return document
  const doc = recordOf(document)
  const setup = recordOf(doc.setup)
  const motion = recordOf(doc.motion)
  const rules = recordOf(doc.rules)
  const touched = (prefix: string) =>
    change.del.some((key) => key.startsWith(prefix)) ||
    Object.keys(change.put).some((key) => key.startsWith(prefix))

  let nextSetup = setup
  if (touched('setup:')) {
    nextSetup = { ...setup }
    for (const kind of LIST_KINDS) {
      if (kind.part !== 'setup') continue
      nextSetup[kind.field] = replaceList(arrayOf(setup[kind.field]), kind.prefix, change)
    }
    if (touched('setup:object:')) {
      const alignment = { ...recordOf(setup.alignment) }
      for (const key of change.del) {
        if (key.startsWith('setup:object:')) delete alignment[key.slice('setup:object:'.length)]
      }
      for (const [key, value] of Object.entries(change.put)) {
        if (!key.startsWith('setup:object:')) continue
        const id = key.slice('setup:object:'.length)
        const record = (value as HaObjectItem).alignment
        if (record === null || record === undefined) delete alignment[id]
        else alignment[id] = record
      }
      nextSetup.alignment = alignment
    }
    if (SCENE_KEY in change.put) {
      const scene = change.put[SCENE_KEY]
      if (scene === null || scene === undefined) delete nextSetup.scene
      else nextSetup.scene = scene
    }
    if (MANUAL_JOG_KEY in change.put) {
      const jog = change.put[MANUAL_JOG_KEY]
      if (jog === null || jog === undefined) delete nextSetup.manualJog
      else nextSetup.manualJog = jog
    }
  }

  let nextMotion = motion
  if (touched('motion:')) {
    nextMotion = {
      ...motion,
      actionSequences: replaceList(arrayOf(motion.actionSequences), 'motion:sequence:', change),
    }
    if (PROGRAMS_KEY in change.put) nextMotion.programs = arrayOf(change.put[PROGRAMS_KEY])
  }

  let nextRules = rules
  if (touched('rules:')) {
    nextRules = { ...rules, rules: replaceList(arrayOf(rules.rules), 'rules:rule:', change) }
  }

  let nextMeta = doc.meta
  if (META_KEY in change.put) {
    const meta = { ...recordOf(doc.meta) }
    const value = recordOf(change.put[META_KEY])
    for (const field of META_FIELDS) {
      if (value[field] === undefined) delete meta[field]
      else meta[field] = value[field]
    }
    nextMeta = meta
  }

  return {
    ...doc,
    meta: nextMeta,
    setup: nextSetup,
    motion: nextMotion,
    rules: nextRules,
  } as T
}

/** 整份替换：用对方的全部项替换本机范围内的部分（核对后二选一，方案 4.3） */
export const replaceSyncScope = <T>(document: T, items: HaSyncItems, scope: HaSyncScope): T => {
  const local = extractSyncItems(document, scope)
  const put: Record<string, unknown> = {}
  for (const [key, value] of items) {
    if (inScope(key, scope)) put[key] = value
  }
  const del = [...local.keys()].filter((key) => !items.has(key))
  const next = applySyncChange(document, { put, del })
  // 数组顺序按对方的来：先整体删掉再按对方顺序加回
  return reorderLikeItems(next, items, scope)
}

const reorderLikeItems = <T>(document: T, items: HaSyncItems, scope: HaSyncScope): T => {
  const doc = recordOf(document)
  const order = (prefix: string) =>
    [...items.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  const sortList = (list: unknown[], prefix: string): unknown[] => {
    const rank = new Map(order(prefix).map((id, index) => [id, index]))
    const last = Number.MAX_SAFE_INTEGER
    return [...list].sort((a, b) => (rank.get(idOf(a) ?? '') ?? last) - (rank.get(idOf(b) ?? '') ?? last))
  }
  const setup = recordOf(doc.setup)
  const nextSetup = {
    ...setup,
    plcs: sortList(arrayOf(setup.plcs), 'setup:plc:'),
    motors: sortList(arrayOf(setup.motors), 'setup:motor:'),
    controlledObjects: sortList(arrayOf(setup.controlledObjects), 'setup:object:'),
  }
  const motion = recordOf(doc.motion)
  const rules = recordOf(doc.rules)
  return {
    ...doc,
    setup: nextSetup,
    motion: scope.motion
      ? { ...motion, actionSequences: sortList(arrayOf(motion.actionSequences), 'motion:sequence:') }
      : motion,
    rules: scope.rules ? { ...rules, rules: sortList(arrayOf(rules.rules), 'rules:rule:') } : rules,
  } as T
}

/** 给人看的项名：「物体 6」「序列 12」… 有名字时用名字 */
export const describeSyncKey = (key: string, value?: unknown): string => {
  const name = (() => {
    const record = recordOf(key.startsWith('setup:object:') ? recordOf(value).object : value)
    return typeof record.name === 'string' && record.name ? record.name : null
  })()
  if (key.startsWith('setup:plc:')) return `PLC ${key.slice('setup:plc:'.length)}`
  if (key.startsWith('setup:motor:')) return `电机 ${key.slice('setup:motor:'.length)}`
  if (key.startsWith('setup:object:')) return name ? `「${name}」` : `物体 ${key.slice('setup:object:'.length)}`
  if (key.startsWith('motion:sequence:')) return name ? `「${name}」` : `序列 ${key.slice('motion:sequence:'.length)}`
  if (key.startsWith('rules:rule:')) return name ? `规则「${name}」` : '规则'
  if (key === SCENE_KEY) return '场景分组'
  if (key === MANUAL_JOG_KEY) return '点动参数'
  if (key === PROGRAMS_KEY) return '节目单'
  if (key === META_KEY) return '工程信息'
  return key
}

/** 改动里有没有配置（搭建）项：主机要下发 PLC，备机要带标志更新设备表 */
export const changeTouchesSetup = (change: HaSyncChange): boolean =>
  change.del.some((key) => key.startsWith('setup:')) ||
  Object.keys(change.put).some((key) => key.startsWith('setup:'))
