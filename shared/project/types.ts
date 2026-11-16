/** 工程 IPC / 主渲染共用契约（wire 形态，非完整业务 schema） */

export type ProjectResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export type ProjectDocumentLike = {
  schemaVersion: string
  meta: {
    id: string
    name: string
    createdAt: string
    modifiedAt: string
    author: string
    status?: string
    note?: string
    tags?: string[]
    wizard: Record<string, unknown>
  }
  setup: Record<string, unknown>
  motion: Record<string, unknown>
  rules: Record<string, unknown>
  /** 主视口相机；当前 schema 必填 */
  view: Record<string, unknown>
  snapshots: unknown[]
}

/**
 * 工程文件能不能被本软件打开（见 shared/project/project-format.ts）：
 * ok 当前格式；upgrade 旧格式，能打开，保存时升级成当前格式；too-new 更高版本软件保存的，不能打开；invalid 读不了
 */
export type ProjectCompat = 'ok' | 'upgrade' | 'too-new' | 'invalid'

export type ProjectSummary = {
  name: string
  /** 读不了的工程没有 id，用 folder:<目录名> */
  id: string
  author: string
  createdAt: string
  modifiedAt: string
  status?: string
  schemaVersion: string
  /** 工程格式版本；读不出来为 null */
  formatVersion: number | null
  compat: ProjectCompat
  /** compat 不是 ok 时给人看的说明 */
  compatMessage?: string
  sizeBytes: number
  hasCover: boolean
  coverPath: string | null
  /** 列表/卡片用；有封面时为主进程读出的 data URL */
  coverDataUrl: string | null
  /** 工程目录绝对路径（供 C++ CONFIG|Pro|open） */
  projectPath: string
  deviceCount: number
  controlledObjectCount: number
}

export type HistoryEntry = {
  id: string
  label: string
  note?: string
  createdAt: string
  author?: string
}

export type DiffEntry = {
  path: string
  type: 'add' | 'remove' | 'change'
  before?: unknown
  after?: unknown
}

export type CreateProjectParams = {
  name: string
  author?: string
}

export type OpenProjectParams = {
  name: string
}

export type SaveProjectParams = {
  document: ProjectDocumentLike
  coverPath?: string
  /** PNG：纯 base64 或 data:image/png;base64,... */
  coverPngBase64?: string
}

export type SaveAsProjectParams = {
  newName: string
}

export type DeleteProjectParams = {
  name: string
}

export type HistoryListParams = {
  name?: string
}

export type HistoryBackupParams = {
  label: string
  note?: string
  author?: string
}

export type HistoryRestoreParams = {
  historyId: string
  /** 不传就是当前打开的工程；版本过高打不开的工程靠这个直接恢复成本软件能读的历史版本 */
  name?: string
}

export type HistoryDiffParams = {
  left: string | 'current'
  right: string | 'current'
  name?: string
}

export type ExportProjectParams = {
  name?: string
}

export type ImportProjectParams = {
  overwrite?: boolean
}

export const ok = <T>(data: T): ProjectResult<T> => ({ ok: true, data })

export const fail = (code: string, message: string): ProjectResult<never> => ({
  ok: false,
  code,
  message,
})
