import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { diffJson } from './diff'
import { appendHistoryEntry, readHistoryIndex } from './history-index'
import {
  getHistorySnapshotPath,
  getProjectJsonPath,
  pathExists,
  validateProjectName,
} from './paths'
import {
  buildSummary,
  ensureProjectScaffold,
  getCurrentProjectName,
  parseProjectDocument,
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

const readAuthor = (text: string): string | undefined => {
  try {
    const author = (JSON.parse(text) as { meta?: { author?: unknown } } | null)?.meta?.author
    return typeof author === 'string' ? author : undefined
  } catch {
    return undefined
  }
}

/** 原样备份盘上的 project.json，旧格式、比本软件新的也能备份 */
const createBackupEntry = async (
  projectName: string,
  params: { label: string; note?: string; author?: string },
): Promise<HistoryEntry> => {
  await ensureProjectScaffold(projectName)
  const text = await fs.readFile(getProjectJsonPath(projectName), 'utf8')
  const entry: HistoryEntry = {
    id: randomUUID(),
    label: params.label.trim() || '未命名备份',
    note: params.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    author: params.author?.trim() || readAuthor(text),
  }
  await appendHistoryEntry(projectName, entry, text)
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
    return ok(await readHistoryIndex(projectName))
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
    const resolved = resolveProjectName(params.name)
    if (!resolved.ok) return resolved
    const projectName = resolved.data

    const snapshotPath = getHistorySnapshotPath(projectName, params.historyId)
    if (!(await pathExists(snapshotPath))) {
      return fail('HISTORY_NOT_FOUND', `快照不存在: ${params.historyId}`)
    }

    // 快照可能是旧格式（升级前备份）或更高版本软件存的：先升到当前格式，本软件读不了的不恢复
    const parsed = parseProjectDocument(await fs.readFile(snapshotPath, 'utf8'))
    if (!parsed.ok) {
      return fail(
        parsed.code,
        parsed.code === 'SCHEMA_TOO_NEW'
          ? `这个历史版本${parsed.message}`
          : `这个历史版本无法读取：${parsed.message}`,
      )
    }

    await createBackupEntry(projectName, {
      label: 'auto-before-restore',
      note: `恢复前自动备份（目标 ${params.historyId}）`,
    })

    const document = parsed.document
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
  const file = ref === 'current'
    ? getProjectJsonPath(projectName)
    : getHistorySnapshotPath(projectName, ref)
  if (!(await pathExists(file))) {
    throw new Error(ref === 'current' ? `工程不存在: ${projectName}` : `快照不存在: ${ref}`)
  }
  // 两边按当前格式比；本软件读不了的（版本过高）按原样比
  const text = await fs.readFile(file, 'utf8')
  const parsed = parseProjectDocument(text)
  return parsed.ok ? parsed.document : (JSON.parse(text) as ProjectDocumentLike)
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
