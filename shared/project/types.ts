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

export type ProjectSummary = {
  name: string
  id: string
  author: string
  createdAt: string
  modifiedAt: string
  status?: string
  schemaVersion: string
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
