import { spawn } from 'node:child_process'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import { movingAxisIds } from '../../../shared/csocket/axis-info'
import { UPDATE_SIGNING_PUBLIC_KEY } from '../../../shared/update/signing-key'
import {
  UPDATE_CHANNELS,
  UPDATE_PACKAGE_EXT,
  UPDATE_PRODUCT,
  type UpdateDownloadProgress,
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

const broadcastProgress = (progress: UpdateDownloadProgress | null): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(UPDATE_CHANNELS.progress, progress)
  }
}

let service: UpdateService | null = null

export const getUpdateService = (): UpdateService => {
  if (service) return service
  const root = resolveUpdatesRoot()
  service = new UpdateService({
    currentVersion: app.getVersion(),
    installSupported: process.platform === 'win32' && app.isPackaged,
    store: new UpdatePackageStore(root, UPDATE_SIGNING_PUBLIC_KEY, UPDATE_PRODUCT),
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
    onProgress: broadcastProgress,
  })
  return service
}

const cancelled = (): UpdateResult<never> => ({ ok: false, code: 'CANCELLED', message: '已取消' })

let registered = false

export const registerUpdateHandlers = (): void => {
  if (registered) return
  registered = true

  ipcMain.handle(UPDATE_CHANNELS.status, () => getUpdateService().status())

  ipcMain.handle(UPDATE_CHANNELS.importPackage, async (event, params?: { filePath?: string }) => {
    let filePath = params?.filePath?.trim()
    if (!filePath) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: '选择升级包',
        properties: ['openFile' as const],
        filters: [{ name: '升级包', extensions: [UPDATE_PACKAGE_EXT.slice(1)] }],
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return cancelled()
      filePath = result.filePaths[0]
    }
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
