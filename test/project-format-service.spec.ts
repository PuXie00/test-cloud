import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/opt/yz/yzapp.exe', getVersion: () => '2.3.0' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  ipcMain: { handle: vi.fn() },
}))

// 假装当前格式是 v2：v1 → v2 给 meta.tags 加一项，方便看出升级过
vi.mock('../shared/project/project-format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/project/project-format')>()
  const migrations = [
    (doc: Record<string, unknown>) => ({
      ...doc,
      meta: { ...(doc.meta as object), tags: ['migrated'] },
    }),
  ]
  return {
    ...actual,
    PROJECT_FORMAT_VERSION: 2,
    PROJECT_MIGRATIONS: migrations,
    migrateProjectDocument: (raw: unknown, options = {}) =>
      actual.migrateProjectDocument(raw, { current: 2, migrations, ...options }),
  }
})

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-format-'))
process.env.YZ_PROJECT_ROOT = tmpRoot

const service = await import('../electron/main/project/service')
const history = await import('../electron/main/project/history')

const doc = (name: string, schemaVersion: string) => ({
  schemaVersion,
  meta: {
    id: `id-${name}`,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-02T00:00:00.000Z',
    author: 'op',
    status: 'draft',
    wizard: {},
  },
  setup: { plcs: [1], motors: [2, 3], controlledObjects: [4] },
  motion: { actionSequences: [], programs: [] },
  rules: { rules: [] },
  view: {},
  snapshots: [],
})

const projectJson = (name: string) => path.join(tmpRoot, name, 'project.json')

const writeRaw = async (name: string, text: string) => {
  await fs.mkdir(path.join(tmpRoot, name), { recursive: true })
  await fs.writeFile(projectJson(name), text, 'utf8')
}

const writeDoc = async (name: string, schemaVersion: string) =>
  writeRaw(name, JSON.stringify(doc(name, schemaVersion), null, 2))

const unwrap = <T>(result: { ok: true; data: T } | { ok: false; code: string; message: string }): T => {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result.data
}

beforeEach(async () => {
  await service.closeProject()
  for (const entry of await fs.readdir(tmpRoot)) {
    await fs.rm(path.join(tmpRoot, entry), { recursive: true, force: true })
  }
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
  delete process.env.YZ_PROJECT_ROOT
})

describe('project list', () => {
  it('lists every project with whether this version can open it', async () => {
    await writeDoc('cur', '2')
    await writeDoc('old', '1')
    await writeDoc('new', '3')
    await writeRaw('bad', '{ not json')
    await fs.mkdir(path.join(tmpRoot, 'not-a-project'))
    await writeDoc('.ha-incoming', '2')

    const byName = new Map(unwrap(await service.listProjects()).map((s) => [s.name, s]))

    expect([...byName.keys()].sort()).toEqual(['bad', 'cur', 'new', 'old'])
    expect(byName.get('cur')).toMatchObject({ compat: 'ok', formatVersion: 2, schemaVersion: '2' })
    expect(byName.get('cur')?.compatMessage).toBeUndefined()
    expect(byName.get('old')).toMatchObject({
      compat: 'upgrade',
      formatVersion: 1,
      schemaVersion: '1',
      deviceCount: 3,
    })
    expect(byName.get('old')?.compatMessage).toContain('v1')
    // 版本过高的照样显示名称、时间、数量
    expect(byName.get('new')).toMatchObject({
      compat: 'too-new',
      formatVersion: 3,
      id: 'id-new',
      author: 'op',
      modifiedAt: '2026-01-02T00:00:00.000Z',
      controlledObjectCount: 1,
    })
    expect(byName.get('new')?.compatMessage).toContain('更高版本')
    expect(byName.get('bad')).toMatchObject({ compat: 'invalid', formatVersion: null, id: 'folder:bad' })
    expect(byName.get('bad')?.compatMessage).toContain('无法读取')
  })
})

describe('open and save', () => {
  it('refuses projects saved by a newer version', async () => {
    await writeDoc('new', '3')
    const result = await service.openProject({ name: 'new' })
    expect(result).toMatchObject({ ok: false, code: 'SCHEMA_TOO_NEW' })
    expect(!result.ok && result.message).toContain('工程「new」')
    expect(service.getCurrentProjectName()).toBeNull()
  })

  it('reports unreadable projects with their own code', async () => {
    await writeRaw('bad', '{"schemaVersion":"what"}')
    expect(await service.openProject({ name: 'bad' })).toMatchObject({ ok: false, code: 'INVALID_DOCUMENT' })
  })

  it('upgrades old projects in memory and leaves the file alone until saved', async () => {
    await writeDoc('old', '1')
    const before = await fs.readFile(projectJson('old'), 'utf8')

    const { document, summary } = unwrap(await service.openProject({ name: 'old' }))

    expect(document.schemaVersion).toBe('2')
    expect(document.meta.tags).toEqual(['migrated'])
    expect(summary.compat).toBe('upgrade')
    expect(await fs.readFile(projectJson('old'), 'utf8')).toBe(before)
  })

  it('backs up the old file once, on the first save in the new format', async () => {
    await writeDoc('old', '1')
    const original = await fs.readFile(projectJson('old'), 'utf8')
    const { document } = unwrap(await service.openProject({ name: 'old' }))

    unwrap(await service.saveProject({ document }))
    unwrap(await service.saveProject({ document }))

    const saved = JSON.parse(await fs.readFile(projectJson('old'), 'utf8'))
    expect(saved.schemaVersion).toBe('2')
    const entries = unwrap(await history.listHistory({ name: 'old' }))
    expect(entries).toHaveLength(1)
    // 名字带做这次升级的软件版本
    expect(entries[0].label).toBe('v2.3.0 升级前自动备份')
    expect(await fs.readFile(path.join(tmpRoot, 'old', 'History', `${entries[0].id}.json`), 'utf8')).toBe(
      original,
    )
    expect(unwrap(await service.listProjects())[0]).toMatchObject({ compat: 'ok', formatVersion: 2 })
  })

  it('save-as copies an old project into the new format and leaves the source alone', async () => {
    await writeDoc('old', '1')
    const original = await fs.readFile(projectJson('old'), 'utf8')
    unwrap(await service.openProject({ name: 'old' }))

    unwrap(await service.saveProjectAs({ newName: 'copy' }))

    expect(JSON.parse(await fs.readFile(projectJson('copy'), 'utf8')).schemaVersion).toBe('2')
    expect(await fs.readFile(projectJson('old'), 'utf8')).toBe(original)
  })
})

describe('history restore across formats', () => {
  const addSnapshot = async (project: string, id: string, schemaVersion: string) => {
    await fs.mkdir(path.join(tmpRoot, project, 'History'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, project, 'History', `${id}.json`),
      JSON.stringify(doc(project, schemaVersion)),
    )
    const indexPath = path.join(tmpRoot, project, 'History', 'index.json')
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8').catch(() => '[]'))
    index.unshift({ id, label: id, createdAt: '2026-01-01T00:00:00.000Z' })
    await fs.writeFile(indexPath, JSON.stringify(index))
  }

  it('restores a project this version cannot open, without opening it', async () => {
    await writeDoc('new', '3')
    const tooNewText = await fs.readFile(projectJson('new'), 'utf8')
    await addSnapshot('new', 'pre-upgrade', '1')

    const restored = unwrap(await history.restoreHistory({ historyId: 'pre-upgrade', name: 'new' }))

    expect(restored.schemaVersion).toBe('2')
    expect(unwrap(await service.listProjects())[0]).toMatchObject({ name: 'new', compat: 'ok' })
    // 恢复前把版本过高的原文件原样备份了
    const entries = unwrap(await history.listHistory({ name: 'new' }))
    const autoBackup = entries.find((e) => e.label === 'auto-before-restore')
    expect(autoBackup?.author).toBe('op')
    expect(await fs.readFile(path.join(tmpRoot, 'new', 'History', `${autoBackup?.id}.json`), 'utf8')).toBe(
      tooNewText,
    )
  })

  it('refuses snapshots from a newer version and leaves everything as it was', async () => {
    await writeDoc('cur', '2')
    await addSnapshot('cur', 'future', '3')
    unwrap(await service.openProject({ name: 'cur' }))

    const result = await history.restoreHistory({ historyId: 'future' })

    expect(result).toMatchObject({ ok: false, code: 'SCHEMA_TOO_NEW' })
    expect(unwrap(await history.listHistory({ name: 'cur' }))).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(projectJson('cur'), 'utf8')).schemaVersion).toBe('2')
  })
})
