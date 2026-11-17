import { app, dialog } from 'electron'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { restoreKeptProjects } from './kept-projects'
import { getKeptProjectsDir, getProjectsRoot } from './paths'

export { registerProjectHandlers } from './ipc'
export type {
  DiffEntry,
  HistoryEntry,
  ProjectDocumentLike,
  ProjectResult,
  ProjectSummary,
} from './types'

/**
 * 卸载程序中途断电之类没把 Project 挪回去的，启动时放回（见 kept-projects.ts）。只有 Windows 的卸载程序会挪。
 * 要在注册工程 IPC、启动 C++ 之前跑完。开发态和单独指定了 YZ_PROJECT_ROOT 时不管。
 */
export const restoreKeptProjectsOnStartup = async (): Promise<void> => {
  if (!app.isPackaged || process.platform !== 'win32' || process.env.YZ_PROJECT_ROOT?.trim()) return
  const keptDir = getKeptProjectsDir()
  try {
    const report = await restoreKeptProjects({ keptDir, projectsRoot: getProjectsRoot() })
    for (const { from, to } of report.moved) console.info(`[project] 工程放回: ${from} -> ${to}`)
    for (const from of report.duplicates) console.info(`[project] 工程已在，丢掉重复的一份: ${from}`)
    if (report.failed.length === 0) return
    for (const { from, message } of report.failed) console.error(`[project] 工程没能放回: ${from}: ${message}`)
    // 正式包不输出日志，没放回去的工程在列表里看不到，要告诉人它们在哪
    void dialog.showMessageBox({
      type: 'warning',
      title: '有工程没能放回工程目录',
      message: `${report.failed.length} 项工程还在 ${keptDir}，暂时不在工程列表里。`,
      detail: `它们没有丢：\n${report.failed.map((f) => f.from).join('\n')}\n\n请关掉可能占用这些文件的程序后重启本软件，会再放一次；也可以手动挪回 ${getProjectsRoot()}。`,
    })
  } catch (err) {
    console.error(`[project] 放回工程失败: ${errorText(err)}`)
  }
}

/**
 * Linux deb 版的工程目录 /opt/<软件名>/Project 由安装脚本建好并设成所有用户可写（build/linux/after-install.tpl）。
 * 写不了时新建、保存工程都会失败，开机就说清楚怎么修，别等到保存时才报权限错误。
 */
export const checkProjectsRootWritableOnStartup = async (): Promise<void> => {
  if (!app.isPackaged || process.platform !== 'linux' || process.env.YZ_PROJECT_ROOT?.trim()) return
  const root = getProjectsRoot()
  try {
    await fs.mkdir(root, { recursive: true })
    await fs.access(root, constants.W_OK)
  } catch (err) {
    void dialog.showMessageBox({
      type: 'warning',
      title: '工程目录不能写入',
      message: `${root} 不能写入，新建、保存工程会失败。`,
      detail: `安装包本来会把它设成所有用户可写。请让管理员在终端运行：\nsudo mkdir -p ${root} && sudo chmod 1777 ${root}\n\n（${errorText(err)}）`,
    })
  }
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
