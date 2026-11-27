import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportProjectLog } from '../electron/main/cSocket/operation-log-export'

let projectDir: string
let destination: string

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-project-log-'))
  destination = path.join(projectDir, '工程日志.log')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(projectDir, { recursive: true, force: true })
})

function openFixture() {
  const db = new Database(path.join(projectDir, 'logs.db'))
  db.exec(`CREATE TABLE log (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, category TEXT, level TEXT, message TEXT,
    user_name TEXT, op_group TEXT, op_type TEXT, addr TEXT, result_ok INTEGER, extra TEXT
  )`)
  return db
}

describe('导出工程日志', () => {
  it('按 ts、id 导出所有类别、级别和原始字段，每条一行 UTF-8 JSON', async () => {
    const db = openFixture()
    const add = db.prepare('INSERT INTO log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const message = '舞台\n轴\t"异常"\\\r重试'
    add.run(9, 200, 'optRet', 'info', '成功', '张三', 'device', 'saveProject', '@A1', 0, null)
    add.run(2, 200, 'optCall', 'debug', '下发', 'A', 'device', 'jog', '/xyz', null, '扩展')
    add.run(4, 100, 'alarm', 'error', message, null, null, null, null, null, null)
    add.run(9007199254740993n, 300, 'system', 'warning', '警告', null, null, null, null, null, null)
    db.close()
    await fs.writeFile(destination, '原文件')
    await exportProjectLog(projectDir, destination)
    const lines = (await fs.readFile(destination, 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    const records = lines.map(line => JSON.parse(line))
    expect(records.map(row => row.category)).toEqual(['alarm', 'optCall', 'optRet', 'system'])
    expect(records[0].message).toBe(message)
    expect(records[1]).toEqual({ ts_iso: '1970-01-01T00:00:00.200Z', id: 2, ts: 200, category: 'optCall', level: 'debug', message: '下发',
      user_name: 'A', op_group: 'device', op_type: 'jog', addr: '/xyz', result_ok: null, extra: '扩展' })
    expect(records[2].result_ok).toBe(0)
    expect(lines[3]).toContain('9007199254740993')
  })

  it('库中存在 ts_iso 时保留原列，额外时间使用未占用的列名', async () => {
    const db = openFixture()
    db.exec("ALTER TABLE log ADD COLUMN ts_iso TEXT")
    db.exec("INSERT INTO log(id, ts, ts_iso) VALUES(1, 200, '旧值'),(2, 9223372036854775807, '溢出')")
    db.close()
    await exportProjectLog(projectDir, destination)
    const records = (await fs.readFile(destination, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line))
    expect(records[0]).toMatchObject({ ts: 200, ts_iso: '旧值', _ts_iso: '1970-01-01T00:00:00.200Z' })
    expect(records[1]).toMatchObject({ ts_iso: '溢出', _ts_iso: null })
  })

  it('批量写出大于单次写入缓冲的日志，空 log 表生成空文件', async () => {
    const db = openFixture()
    await exportProjectLog(projectDir, destination)
    expect(await fs.readFile(destination, 'utf8')).toBe('')
    db.exec(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i < 2500)
      INSERT INTO log (id, ts, category, level, message) SELECT i, 2501-i, 'system', 'info', '测试日志' FROM n`)
    db.close()
    await exportProjectLog(projectDir, destination)
    const lines = (await fs.readFile(destination, 'utf8')).trimEnd().split('\n')
    expect(lines.map(line => JSON.parse(line).id)).toEqual(Array.from({ length: 2500 }, (_, i) => 2500-i))
  })

  it('日志缺失和损坏时保留已有文件并清理临时文件', async () => {
    await fs.writeFile(destination, '已有文件')
    await expect(exportProjectLog(projectDir, destination)).rejects.toThrow('当前工程还没有日志')
    await fs.writeFile(path.join(projectDir, 'logs.db'), '损坏')
    await expect(exportProjectLog(projectDir, destination)).rejects.toThrow()
    expect(await fs.readFile(destination, 'utf8')).toBe('已有文件')
    expect((await fs.readdir(projectDir)).sort()).toEqual(['logs.db', '工程日志.log'])
  })

  it('独占提交时只允许一项并发导出成功，已存在的目标不覆盖', async () => {
    openFixture().close()
    const results = await Promise.allSettled([
      exportProjectLog(projectDir, destination, false),
      exportProjectLog(projectDir, destination, false),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'EEXIST' } })
    await fs.writeFile(destination, '保留')
    await expect(exportProjectLog(projectDir, destination, false)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(destination, 'utf8')).toBe('保留')
    expect((await fs.readdir(projectDir)).sort()).toEqual(['logs.db', '工程日志.log'])
  })

  it('部分写出后遇到磁盘错误，已有文件和工程文件保持完整', async () => {
    const db = openFixture()
    const add = db.prepare('INSERT INTO log (ts, message) VALUES (0, ?)')
    add.run('甲'.repeat(70000))
    add.run('乙'.repeat(70000))
    db.close()
    await fs.writeFile(destination, '已有文件')
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      const write = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile')
        .mockImplementationOnce(write)
        .mockRejectedValueOnce(Object.assign(new Error('磁盘已满'), { code: 'ENOSPC' }))
      return handle
    })
    await expect(exportProjectLog(projectDir, destination)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(await fs.readFile(destination, 'utf8')).toBe('已有文件')
    expect((await fs.readdir(projectDir)).sort()).toEqual(['logs.db', '工程日志.log'])
  })

  it('不支持硬链接的介质可创建新文件，已存在的文件仍须确认覆盖', async () => {
    openFixture().close()
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('不支持硬链接'), { code: 'ENOTSUP' }))
    await exportProjectLog(projectDir, destination, false)
    expect(await fs.readFile(destination, 'utf8')).toBe('')
    await fs.writeFile(destination, '保留')
    await expect(exportProjectLog(projectDir, destination, false)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(destination, 'utf8')).toBe('保留')
  })
})
