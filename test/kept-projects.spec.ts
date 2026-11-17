import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { restoreKeptProjects } from '../electron/main/project/kept-projects'

describe('restoreKeptProjects', () => {
  let tmp: string
  let keptDir: string
  let projectsRoot: string

  const writeProject = async (dir: string, json: string, extra: Record<string, string> = {}) => {
    await fs.mkdir(path.join(dir, 'History'), { recursive: true })
    await fs.writeFile(path.join(dir, 'project.json'), json)
    for (const [name, content] of Object.entries(extra)) {
      await fs.writeFile(path.join(dir, name), content)
    }
  }

  const exists = async (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    )

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-kept-'))
    // 和安装目录的关系：<安装目录>\Project 与 <安装目录>.project-keep
    projectsRoot = path.join(tmp, 'yzapp', 'Project')
    keptDir = path.join(tmp, 'yzapp.project-keep')
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('does nothing when nothing was left behind', async () => {
    await writeProject(path.join(projectsRoot, 'a'), '{}')
    expect(await restoreKeptProjects({ keptDir, projectsRoot })).toEqual({ moved: [], duplicates: [], failed: [] })
    expect(await exists(path.join(projectsRoot, 'a', 'project.json'))).toBe(true)
  })

  it('puts the whole folder back when Project is gone (uninstall stopped halfway)', async () => {
    await fs.mkdir(path.join(tmp, 'yzapp'), { recursive: true })
    await writeProject(path.join(keptDir, '广州'), '{"a":1}', { 'logs.db': 'db' })
    await fs.mkdir(path.join(keptDir, '.ha-incoming'))

    const report = await restoreKeptProjects({ keptDir, projectsRoot })

    expect(report.moved).toEqual([{ from: keptDir, to: projectsRoot }])
    expect(await fs.readFile(path.join(projectsRoot, '广州', 'logs.db'), 'utf8')).toBe('db')
    expect(await exists(path.join(projectsRoot, '.ha-incoming'))).toBe(true)
    expect(await exists(keptDir)).toBe(false)
  })

  it('merges into an existing Project without overwriting anything', async () => {
    await writeProject(path.join(projectsRoot, 'same'), '{"v":1}')
    await writeProject(path.join(projectsRoot, 'diff'), '{"v":"new"}')
    await writeProject(path.join(keptDir, 'same'), '{"v":1}')
    await writeProject(path.join(keptDir, 'diff'), '{"v":"old"}')
    await writeProject(path.join(keptDir, 'only-kept'), '{"v":2}')
    await fs.mkdir(path.join(keptDir, '.ha-incoming'))

    const report = await restoreKeptProjects({ keptDir, projectsRoot })

    expect(report.duplicates).toEqual([path.join(keptDir, 'same')])
    expect(report.moved.map((m) => path.basename(m.to)).sort()).toEqual(['diff（恢复）', 'only-kept'])
    expect(await fs.readFile(path.join(projectsRoot, 'diff', 'project.json'), 'utf8')).toBe('{"v":"new"}')
    expect(await fs.readFile(path.join(projectsRoot, 'diff（恢复）', 'project.json'), 'utf8')).toBe('{"v":"old"}')
    // 搬完只剩临时目录：整个删掉，下次卸载才不会被挡住
    expect(await exists(keptDir)).toBe(false)
  })

  it('numbers the new names when the first one is taken', async () => {
    await writeProject(path.join(projectsRoot, 'p'), '{"v":0}')
    await writeProject(path.join(projectsRoot, 'p（恢复）'), '{"v":1}')
    await writeProject(path.join(keptDir, 'p'), '{"v":2}')

    const report = await restoreKeptProjects({ keptDir, projectsRoot })

    expect(report.moved.map((m) => path.basename(m.to))).toEqual(['p（恢复 2）'])
  })
})
