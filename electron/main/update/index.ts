import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import { movingAxisIds } from '../../../shared/csocket/axis-info'
import { UPDATE_SIGNING_PUBLIC_KEY } from '../../../shared/update/signing-key'
import {
  UPDATE_CHANNELS,
  UPDATE_PACKAGE_EXT,
  UPDATE_PRODUCT,
  type UpdatePickedFile,
  type UpdateResult,
} from '../../../shared/update/types'
import { getCsocketApiService, shutdownCppSocket } from '../cSocket'
import { shutdownKinematics } from '../kinematics'
import { releaseCloseGuards } from '../tool'
import { takeInstallOutcome } from './install-record'
import {
  describeLinuxInstallExit,
  launchLinuxInstall,
  LINUX_INSTALL_HELPER,
  linuxInstallUnsupportedReason,
  NSIS_SILENT_ARGS,
  PKEXEC_PATH,
  spawnDetached,
} from './installers'
import { normalizeUpdateUrl } from './online'
import { UpdatePackageStore } from './package-store'
import { UpdateService, type InstallLaunch } from './service'

/**
 * 升级包、下载不放安装目录：
 * - Windows：%LOCALAPPDATA%\<软件名>\Updates。装新版本时卸载程序会删安装目录（只留 Project），安装程序就是从这里运行的
 * - Linux：~/.local/share/<软件名>/Updates（XDG_DATA_HOME）。/opt 下普通用户写不了，升级包几百 MB 也不适合放 ~/.config
 */
const resolveUpdatesRoot = (): string => {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) return path.join(localAppData, app.getName(), 'Updates')
  }
  if (process.platform === 'linux') {
    const dataHome = process.env.XDG_DATA_HOME?.trim()
    const base = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(os.homedir(), '.local', 'share')
    return path.join(base, app.getName(), 'Updates')
  }
  return path.join(app.getPath('userData'), 'Updates')
}

/** 启动安装前记的一笔、Linux 安装脚本写的退出码和输出，都在 Updates 目录 */
const installFiles = (root: string) => ({
  pending: path.join(root, 'pending-install.json'),
  result: path.join(root, 'install-result.txt'),
  log: path.join(root, 'install.log'),
})

/** 能在软件里装为 null：Windows 安装版；Linux 用 deb 装在 /opt 下、系统有 pkexec 和 apt-get */
const installUnsupportedReason = (): string | null => {
  if (!app.isPackaged) return '开发态不能在软件里安装'
  if (process.platform === 'win32') return null
  if (process.platform === 'linux') {
    return linuxInstallUnsupportedReason({
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      exists: existsSync,
    })
  }
  return '这个系统还不能在软件里安装'
}

/** 有轴在动就不装：装的时候要停掉 C++，设备会断开主机。没有轴数据时放行（同下载工程） */
const motionBlock = (): string | null => {
  const snapshot = getCsocketApiService().getAxisInfoSnapshot().data
  const count = Array.isArray(snapshot)
    ? movingAxisIds(snapshot as { deviceId: number; axisStatus?: number }[]).length
    : 0
  return count > 0 ? `${count} 个轴运动中，全部停止后再升级` : null
}

const launchInstaller = (root: string, pkg: InstallLaunch): Promise<void> => {
  if (process.platform !== 'linux') return spawnDetached(pkg.installerPath, NSIS_SILENT_ARGS)
  const files = installFiles(root)
  return launchLinuxInstall({
    appPid: process.pid,
    pkexec: PKEXEC_PATH,
    helper: path.join(process.resourcesPath, LINUX_INSTALL_HELPER),
    packageDir: pkg.packageDir,
    resultFile: files.result,
    logFile: files.log,
    // 原样带上启动参数重新打开（同一路径，装好了就是新版本）
    relaunch: [process.execPath, ...process.argv.slice(1)],
  })
}

const broadcast = (channel: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

let service: UpdateService | null = null

export const getUpdateService = (): UpdateService => {
  if (service) return service
  const root = resolveUpdatesRoot()
  const target = { platform: process.platform, arch: process.arch }
  service = new UpdateService({
    currentVersion: app.getVersion(),
    target,
    installUnsupportedReason: installUnsupportedReason(),
    store: new UpdatePackageStore(root, UPDATE_SIGNING_PUBLIC_KEY, UPDATE_PRODUCT, target),
    onlineUrl: normalizeUpdateUrl(process.env.YZ_UPDATE_URL),
    downloadsDir: path.join(root, 'downloads'),
    // 走 Chromium 网络栈，跟系统代理
    fetch: (url, init) => net.fetch(url, init),
    motionBlock,
    launchInstaller: (pkg) => launchInstaller(root, pkg),
    pendingInstallFile: installFiles(root).pending,
    stopRuntimes: () => {
      shutdownCppSocket()
      shutdownKinematics()
    },
    quit: () => {
      releaseCloseGuards()
      setImmediate(() => app.quit())
    },
    onProgress: (progress) => broadcast(UPDATE_CHANNELS.progress, progress),
    onImportProgress: (progress) => broadcast(UPDATE_CHANNELS.importProgress, progress),
  })
  return service
}

/**
 * 上次在软件里升级没装成（还是原来的版本）就告诉人原因；装成了不打扰。
 * Linux 授权窗口被关掉、apt-get 失败后会重新打开旧版本，Windows 静默安装出错什么提示都没有。
 */
export const reportLastInstallOnStartup = async (): Promise<void> => {
  if (!app.isPackaged) return
  const files = installFiles(resolveUpdatesRoot())
  try {
    const outcome = await takeInstallOutcome({
      pendingFile: files.pending,
      currentVersion: app.getVersion(),
      resultFile: process.platform === 'linux' ? files.result : undefined,
      describeExit: describeLinuxInstallExit,
    })
    if (!outcome) return
    const { fromVersion, toVersion } = outcome.pending
    if (outcome.ok) {
      console.info(`[update] 已从 v${fromVersion} 装到 v${toVersion}`)
      return
    }
    console.warn(`[update] 升级到 v${toVersion} 没有完成：${outcome.reason}`)
    const logHint = process.platform === 'linux' && existsSync(files.log) ? `\n\n安装记录：${files.log}` : ''
    await dialog.showMessageBox({
      type: 'warning',
      title: '升级没有完成',
      message: `升级到 v${toVersion} 没有完成，软件还是 v${fromVersion}。`,
      detail: `${outcome.reason}。\n\n升级包还在本机，可以在 系统设置 › 软件更新 里再装一次。${logHint}`,
    })
  } catch (err) {
    console.error(`[update] 读取上次安装结果失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const cancelled = (): UpdateResult<never> => ({ ok: false, code: 'CANCELLED', message: '已取消' })

let registered = false

export const registerUpdateHandlers = (): void => {
  if (registered) return
  registered = true

  ipcMain.handle(UPDATE_CHANNELS.status, () => getUpdateService().status())

  // 选文件和导入分开：选完界面马上能显示「正在读取 xxx」，再开始导入
  ipcMain.handle(UPDATE_CHANNELS.pickPackage, async (event): Promise<UpdateResult<UpdatePickedFile>> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '选择升级包',
      properties: ['openFile' as const],
      filters: [{ name: '升级包', extensions: [UPDATE_PACKAGE_EXT.slice(1)] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return cancelled()
    const filePath = result.filePaths[0]
    try {
      const { size } = await fs.stat(filePath)
      return { ok: true, data: { filePath, fileName: path.basename(filePath), sizeBytes: size } }
    } catch (err) {
      return { ok: false, code: 'READ_FAILED', message: `读不到这个文件（${err instanceof Error ? err.message : String(err)}）` }
    }
  })

  ipcMain.handle(UPDATE_CHANNELS.importPackage, (_event, params: { filePath?: unknown } | undefined) => {
    const filePath = typeof params?.filePath === 'string' ? params.filePath.trim() : ''
    if (!filePath) return { ok: false, code: 'BAD_REQUEST', message: '没有指定升级包文件' }
    return getUpdateService().importPackage(filePath)
  })

  ipcMain.handle(UPDATE_CHANNELS.check, () => getUpdateService().check())
  ipcMain.handle(UPDATE_CHANNELS.download, () => getUpdateService().downloadLatest())
  ipcMain.handle(UPDATE_CHANNELS.cancelDownload, () => {
    getUpdateService().cancelDownload()
    return { ok: true, data: null }
  })
  ipcMain.handle(UPDATE_CHANNELS.install, (_event, params: { version?: string } | undefined) =>
    getUpdateService().install(String(params?.version ?? '')),
  )
}
