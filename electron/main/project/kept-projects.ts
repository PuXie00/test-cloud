import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECT_JSON, pathExists } from './paths'

/**
 * 卸载程序（升级、回退、卸载都会跑）删程序文件前把 <安装目录>/Project 挪到 <安装目录>.project-keep，
 * 删完挪回去（build/installer.nsh）。中途断电之类没挪回去的，软件启动时在这里放回：
 * - Project 不在：整个改名回去
 * - Project 已经有了：逐个搬回去，同名时 project.json 一样就丢掉这份，不一样就改名保留，不覆盖
 */

export type KeptProjectsReport = {
  moved: { from: string; to: string }[]
  /** Project 里已有一模一样的工程，这份丢掉了 */
  duplicates: string[]
  failed: { from: string; message: string }[]
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** .开头的是 C++ 等用的临时目录（如 .ha-incoming），不算工程 */
const isHiddenEntry = (name: string): boolean => name.startsWith('.')

const readFileOrNull = async (file: string): Promise<Buffer | null> => {
  try {
    return await fs.readFile(file)
  } catch {
    return null
  }
}

const sameProjectJson = async (a: string, b: string): Promise<boolean> => {
  const [left, right] = await Promise.all([
    readFileOrNull(path.join(a, PROJECT_JSON)),
    readFileOrNull(path.join(b, PROJECT_JSON)),
  ])
  return left !== null && right !== null && left.equals(right)
}

const freeName = async (root: string, name: string): Promise<string> => {
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? `${name}（恢复）` : `${name}（恢复 ${i}）`
    if (!(await pathExists(path.join(root, candidate)))) return candidate
  }
}

export const restoreKeptProjects = async (params: {
  /** <安装目录>.project-keep */
  keptDir: string
  /** <安装目录>/Project */
  projectsRoot: string
}): Promise<KeptProjectsReport> => {
  const report: KeptProjectsReport = { moved: [], duplicates: [], failed: [] }
  const { keptDir, projectsRoot } = params
  if (!(await pathExists(keptDir))) return report

  if (!(await pathExists(projectsRoot))) {
    try {
      await fs.rename(keptDir, projectsRoot)
      report.moved.push({ from: keptDir, to: projectsRoot })
    } catch (err) {
      report.failed.push({ from: keptDir, message: errorText(err) })
    }
    return report
  }

  let entries: string[]
  try {
    entries = (await fs.readdir(keptDir)).filter((name) => !isHiddenEntry(name)).sort()
  } catch (err) {
    report.failed.push({ from: keptDir, message: errorText(err) })
    return report
  }
  for (const name of entries) {
    const from = path.join(keptDir, name)
    try {
      let to = path.join(projectsRoot, name)
      if (await pathExists(to)) {
        if (await sameProjectJson(from, to)) {
          await fs.rm(from, { recursive: true, force: true })
          report.duplicates.push(from)
          continue
        }
        to = path.join(projectsRoot, await freeName(projectsRoot, name))
      }
      await fs.rename(from, to)
      report.moved.push({ from, to })
    } catch (err) {
      report.failed.push({ from, message: errorText(err) })
    }
  }
  // 工程都搬回去了，剩下的只是临时目录：整个删掉，下次卸载才不会被它挡住
  if (report.failed.length === 0) {
    await fs.rm(keptDir, { recursive: true, force: true }).catch((err) => {
      report.failed.push({ from: keptDir, message: errorText(err) })
    })
  }
  return report
}
