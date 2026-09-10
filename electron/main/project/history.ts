import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { diffJson } from './diff'
import {
  getHistoryIndexPath,
  getHistorySnapshotPath,
  pathExists,
  validateProjectName,
} from './paths'
import {
  buildSummary,
  ensureProjectScaffold,
  getCurrentProjectName,
  readProjectDocument,
  writeProjectDocument,
} from './service'
import type {
  DiffEntry,
  HistoryBackupParams,
  HistoryDiffParams,
  HistoryEntry,
  HistoryListParams,
  HistoryRestoreParams,
  ProjectDocumentLike,
  ProjectResult,
} from './types'
import { fail, ok } from './types'

const resolveProjectName = (name?: string): ProjectResult<string> => {
  const target = (name ?? getCurrentProjectName())?.trim()
  if (!target) return fail('NO_CURRENT', '当前没有打开的工程，且未指定工程名')
  const nameError = validateProjectName(target)
  if (nameError) return fail('INVALID_NAME', nameError)
  return ok(target)
}

const readIndex = async (projectName: string): Promise<HistoryEntry[]> => {
  const indexPath = getHistoryIndexPath(projectName)
  if (!(await pathExists(indexPath))) return []
  const raw = await fs.readFile(indexPath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is HistoryEntry => {
    if (!item || typeof item !== 'object') return false
    const e = item as Record<string, unknown>
    return typeof e.id === 'string' && typeof e.label === 'string' && typeof e.createdAt === 'string'
  })
}

const writeIndex = async (projectName: string, entries: HistoryEntry[]): Promise<void> => {
  await fs.writeFile(getHistoryIndexPath(projectName), JSON.stringify(entries, null, 2), 'utf8')
}

const writeSnapshotFile = async (
  projectName: string,
  historyId: string,
  document: ProjectDocumentLike,
): Promise<void> => {
  const snapshot: ProjectDocumentLike = {
    ...document,
    snapshots: [],
  }
  await fs.writeFile(
    getHistorySnapshotPath(projectName, historyId),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  )
}

const createBackupEntry = async (
  projectName: string,
  params: { label: string; note?: string; author?: string },
): Promise<HistoryEntry> => {
  await ensureProjectScaffold(projectName)
  const document = await readProjectDocument(projectName)
  const entry: HistoryEntry = {
    id: randomUUID(),
    label: params.label.trim() || '未命名备份',
    note: params.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    author: params.author?.trim() || document.meta.author,
  }
  await writeSnapshotFile(projectName, entry.id, document)
  const index = await readIndex(projectName)
  index.unshift(entry)
  await writeIndex(projectName, index)
  return entry
}

export const listHistory = async (
  params: HistoryListParams = {},
): Promise<ProjectResult<HistoryEntry[]>> => {
  try {
    const resolved = resolveProjectName(params.name)
    if (!resolved.ok) return resolved
    const projectName = resolved.data
    await ensureProjectScaffold(projectName)
    return ok(await readIndex(projectName))
  } catch (err) {
    return fail('HISTORY_LIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const backupHistory = async (
  params: HistoryBackupParams,
): Promise<ProjectResult<HistoryEntry>> => {
  try {
    const resolved = resolveProjectName()
    if (!resolved.ok) return resolved
    if (!params.label?.trim()) return fail('INVALID_LABEL', '备份名称不能为空')

    const entry = await createBackupEntry(resolved.data, params)
    return ok(entry)
  } catch (err) {
    return fail('HISTORY_BACKUP_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const restoreHistory = async (
  params: HistoryRestoreParams,
): Promise<ProjectResult<ProjectDocumentLike>> => {
  try {
    const resolved = resolveProjectName()
    if (!resolved.ok) return resolved
    const projectName = resolved.data

    const snapshotPath = getHistorySnapshotPath(projectName, params.historyId)
    if (!(await pathExists(snapshotPath))) {
      return fail('HISTORY_NOT_FOUND', `快照不存在: ${params.historyId}`)
    }

    await createBackupEntry(projectName, {
      label: 'auto-before-restore',
      note: `恢复前自动备份（目标 ${params.historyId}）`,
    })

    const raw = await fs.readFile(snapshotPath, 'utf8')
    const document = JSON.parse(raw) as ProjectDocumentLike
    document.snapshots = []
    document.meta.name = projectName
    await writeProjectDocument(projectName, document)
    // touch summary path for consistency
    await buildSummary(projectName)
    return ok(await readProjectDocument(projectName))
  } catch (err) {
    return fail('HISTORY_RESTORE_FAILED', err instanceof Error ? err.message : String(err))
  }
}

const loadDiffSource = async (
  projectName: string,
  ref: string | 'current',
): Promise<ProjectDocumentLike> => {
  if (ref === 'current') {
    return readProjectDocument(projectName)
  }
  const snapshotPath = getHistorySnapshotPath(projectName, ref)
  if (!(await pathExists(snapshotPath))) {
    throw new Error(`快照不存在: ${ref}`)
  }
  const raw = await fs.readFile(snapshotPath, 'utf8')
  return JSON.parse(raw) as ProjectDocumentLike
}

export const diffHistory = async (
  params: HistoryDiffParams,
): Promise<ProjectResult<DiffEntry[]>> => {
  try {
    const resolved = resolveProjectName(params.name)
    if (!resolved.ok) return resolved
    const projectName = resolved.data

    if (params.left === params.right) {
      return ok([])
    }

    const leftDoc = await loadDiffSource(projectName, params.left)
    const rightDoc = await loadDiffSource(projectName, params.right)
    return ok(diffJson(leftDoc, rightDoc))
  } catch (err) {
    return fail('HISTORY_DIFF_FAILED', err instanceof Error ? err.message : String(err))
  }
}
