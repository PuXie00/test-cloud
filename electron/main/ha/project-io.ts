import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { HaResult, HaSyncRecord } from '../../../shared/ha/types'
import type { ProjectDocumentLike } from '../../../shared/project/types'
import { appendHistoryEntry } from '../project/history-index'
import { getProjectJsonPath } from '../project/paths'
import { getCurrentProjectName, readProjectDocument } from '../project/service'

const ok = <T>(data: T): HaResult<T> => ({ ok: true, data })
const fail = (code: string, message: string): HaResult<never> => ({ ok: false, code, message })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 工程信息里同步的字段（和 shared/ha/sync-items 一致） */
const META_SYNC_FIELDS = ['author', 'status', 'note', 'tags', 'wizard'] as const

/** 备机写盘时同步范围内的部分：配置总有，其它按同步范围 */
export type HaSyncedParts = {
  projectId: string
  setup: unknown
  motion?: unknown
  rules?: unknown
  meta?: unknown
  view?: unknown
}

/** 先写临时文件并落盘，再改名覆盖：写到一半断电不会留下半个文件 */
export const writeJsonAtomic = async (filePath: string, data: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.ha-tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, filePath)
}

/**
 * 备机把同步范围内的内容写进本机 project.json（方案 5.7）：
 * 配置实时下发，主机没保存时 PLC 里也已经是新配置；备机的 C++ 打开工程读的是 project.json，
 * 备机关闭热备接手时读到的也必须是最新的。范围外的部分保持盘上原样。
 */
export const writeSyncedParts = async (parts: HaSyncedParts): Promise<HaResult<null>> => {
  const name = getCurrentProjectName()
  if (!name) return fail('NO_CURRENT', '没有打开工程')
  try {
    const document = await readProjectDocument(name)
    if (document.meta.id !== parts.projectId) return fail('PROJECT_MISMATCH', '工程已经切换')
    const next: ProjectDocumentLike = {
      ...document,
      setup: isRecord(parts.setup) ? parts.setup : document.setup,
      motion: isRecord(parts.motion) ? parts.motion : document.motion,
      rules: isRecord(parts.rules) ? parts.rules : document.rules,
      view: isRecord(parts.view) ? parts.view : document.view,
      snapshots: [],
      meta: { ...document.meta, modifiedAt: new Date().toISOString() },
    }
    if (isRecord(parts.meta)) {
      const meta = next.meta as Record<string, unknown>
      for (const field of META_SYNC_FIELDS) {
        if (parts.meta[field] === undefined) delete meta[field]
        else meta[field] = parts.meta[field]
      }
    }
    await writeJsonAtomic(getProjectJsonPath(name), next)
    return ok(null)
  } catch (err) {
    return fail('WRITE_FAILED', `写工程文件失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 被覆盖的那一台，覆盖前存一个版本备份（方案 4.3）；存的是界面里当前的内容，包括没保存的修改 */
export const backupBeforeOverwrite = async (params: {
  document: unknown
  label: string
  note?: string
}): Promise<HaResult<null>> => {
  const name = getCurrentProjectName()
  if (!name) return fail('NO_CURRENT', '没有打开工程')
  if (!isRecord(params.document)) return fail('INVALID_DOCUMENT', '工程内容无效')
  try {
    await appendHistoryEntry(
      name,
      {
        id: randomUUID(),
        label: params.label.trim() || '热备同步前自动备份',
        note: params.note?.trim() || undefined,
        createdAt: new Date().toISOString(),
      },
      JSON.stringify(params.document, null, 2),
    )
    return ok(null)
  } catch (err) {
    return fail('BACKUP_FAILED', `存版本备份失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 备机的同步记录：按工程 id 存在本机用户数据目录 */
export const createSyncRecordStore = (filePath: string) => {
  let cache: Record<string, HaSyncRecord> | null = null
  const load = async (): Promise<Record<string, HaSyncRecord>> => {
    if (cache) return cache
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
      cache = isRecord(parsed) ? (parsed as Record<string, HaSyncRecord>) : {}
    } catch {
      cache = {}
    }
    return cache
  }
  return {
    get: async (projectId: string): Promise<HaSyncRecord | null> => {
      const record = (await load())[projectId]
      return isRecord(record) && typeof record.digest === 'string' ? record : null
    },
    set: async (projectId: string, record: HaSyncRecord | null): Promise<void> => {
      const all = { ...(await load()) }
      if (record) all[projectId] = record
      else delete all[projectId]
      cache = all
      await writeJsonAtomic(filePath, all)
    },
  }
}
