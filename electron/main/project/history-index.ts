import fs from 'node:fs/promises'
import { getHistoryDir, getHistoryIndexPath, getHistorySnapshotPath, pathExists } from './paths'
import type { HistoryEntry } from './types'

/** History/index.json 读写；service（升级前备份）和 history（手动备份 / 恢复）共用 */

export const readHistoryIndex = async (projectName: string): Promise<HistoryEntry[]> => {
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

export const writeHistoryIndex = async (projectName: string, entries: HistoryEntry[]): Promise<void> => {
  await fs.writeFile(getHistoryIndexPath(projectName), JSON.stringify(entries, null, 2), 'utf8')
}

/** 写快照文件并把条目加到列表最前面。snapshotText 原样写入（升级前备份要保留旧文件的原样） */
export const appendHistoryEntry = async (
  projectName: string,
  entry: HistoryEntry,
  snapshotText: string,
): Promise<void> => {
  await fs.mkdir(getHistoryDir(projectName), { recursive: true })
  await fs.writeFile(getHistorySnapshotPath(projectName, entry.id), snapshotText, 'utf8')
  const index = await readHistoryIndex(projectName)
  index.unshift(entry)
  await writeHistoryIndex(projectName, index)
}
