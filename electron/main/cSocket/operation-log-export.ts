import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { LOG_DB_FILE } from './operation-log-db'

const BUFFER_CHARS = 64 * 1024

/** SQLite 的 64 位整数直接写十进制，避免通过 JS number 损失精度。 */
function logLine(row: Record<string, unknown>, isoKey: string): string {
  const fields = Object.entries(row).map(([key, value]) =>
    JSON.stringify(key) + ':' + (typeof value === 'bigint' ? value.toString() : JSON.stringify(value)),
  )
  const ts = row.ts
  const isoTime = typeof ts === 'bigint' || typeof ts === 'number' ? new Date(Number(ts)).toJSON() : null
  fields.unshift(JSON.stringify(isoKey) + ':' + JSON.stringify(isoTime))
  return '{' + fields.join(',') + '}\n'
}

async function writeRows(source: string, output: FileHandle): Promise<void> {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    // 同一条 SELECT 的一致性快照。逐行读取所有列，包括不同版本的扩展字段。
    const query = db.prepare<[], Record<string, unknown>>('SELECT * FROM log ORDER BY ts, id').safeIntegers()
    const columns = new Set(query.columns().map(column => column.name))
    let isoKey = 'ts_iso'
    while (columns.has(isoKey)) isoKey = '_' + isoKey
    let buffer = ''
    for (const row of query.iterate()) {
      buffer += logLine(row, isoKey)
      if (buffer.length >= BUFFER_CHARS) {
        await output.writeFile(buffer, 'utf8')
        buffer = ''
      }
    }
    if (buffer) await output.writeFile(buffer, 'utf8')
  } finally {
    db.close()
  }
}

async function publishNewFile(temp: string, destination: string): Promise<void> {
  try {
    await fs.link(temp, destination)
  } catch (error) {
    // FAT 等介质不支持硬链接，仍由文件系统独占创建，不覆盖已有文件。
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error
    await fs.copyFile(temp, destination, constants.COPYFILE_EXCL)
  }
}

export async function exportProjectLog(projectDir: string, destination: string, overwrite = true): Promise<void> {
  const source = path.join(projectDir, LOG_DB_FILE)
  try {
    await fs.access(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('当前工程还没有日志')
    throw error
  }

  const temp = path.join(path.dirname(destination), `.operation-log-${randomUUID()}.tmp`)
  const output = await fs.open(temp, 'wx', 0o600)
  try {
    try {
      await writeRows(source, output)
    } finally {
      await output.close()
    }
    if (overwrite) await fs.rename(temp, destination)
    else await publishNewFile(temp, destination)
  } finally {
    await fs.rm(temp, { force: true })
  }
}
