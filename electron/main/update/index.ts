import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
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
import { normalizeUpdateUrl } from './online'
import { UpdatePackageStore } from './package-store'
import { UpdateService } from './service'

/**
 * 升级包、下载放在 %LOCALAPPDATA%\<软件名>\Updates，不放安装目录：装新版本时卸载程序会删安装目录（只留 Project），
 * 而且安装程序就是从这里运行的。其他系统放用户数据目录。
 */
const resolveUpdatesRoot = (): string => {
  const localAppData = process.platform === 'win32' ? process.env.LOCALAPPDATA?.trim() : undefined
  return localAppData
    ? path.join(localAppData, app.getName(), 'Updates')
    : path.join(app.getPath('userData'), 'Updates')
}

/** 有轴在动就不装：装的时候要停掉 C++，设备会断开主机。没有轴数据时放行（同下载工程） */
const motionBlock = (): string | null => {
  const snapshot = getCsocketApiService().getAxisInfoSnapshot().data
  const count = Array.isArray(snapshot)
    ? movingAxisIds(snapshot as { deviceId: number; axisStatus?: number }[]).length
    : 0
  return count > 0 ? `${count} 个轴运动中，全部停止后再升级` : null
}

const launchInstaller = (installerPath: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(installerPath, [...args], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

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
    // 软件里装：目前只有 Windows 安装版（NSIS）；Linux 还要按发布方式（deb / AppImage）接安装步骤
    installSupported: process.platform === 'win32' && app.isPackaged,
    store: new UpdatePackageStore(root, UPDATE_SIGNING_PUBLIC_KEY, UPDATE_PRODUCT, target),
    onlineUrl: normalizeUpdateUrl(process.env.YZ_UPDATE_URL),
    downloadsDir: path.join(root, 'downloads'),
    // 走 Chromium 网络栈，跟系统代理
    fetch: (url, init) => net.fetch(url, init),
    motionBlock,
    launchInstaller,
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
