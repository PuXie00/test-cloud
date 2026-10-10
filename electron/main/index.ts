import { app, BrowserWindow, Menu, shell } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { registerCppSocketHandlers, shutdownCppSocket } from './cSocket'
import { registerKinematicsHandlers, shutdownKinematics } from './kinematics'
import { registerToolHandlers } from './tool'
import { registerConfigHandlers } from './getConfig'
import { registerProjectHandlers } from './project'
// import { update } from './update'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL


process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST
// process.env.YZ_CPP_WS_URL = process.env.YZ_CPP_WS_URL || 'ws://127.0.0.1:9000'
// process.env.YZ_CPP_RUNTIME_PATH = process.env.YZ_CPP_RUNTIME_PATH || path.join(process.env.APP_ROOT, 'YzRuntime.exe')
// process.env.YZ_CPP_RUNTIME_EXE = process.env.YZ_CPP_RUNTIME_EXE || 'YzRuntime.exe'

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Linux: 禁用 GPU 合成防止长时间运行纹理内存泄漏；增大 V8 堆上限
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096')
}

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}


let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')


// 显示主窗口并关闭启动页
function showMainWindow() {
  if (win) {
    win.show()
    win.focus()
  }
}

async function createWindow() {
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    title: '租赁舞台控制系统',
    width: 1440,
    height: 900,
    minWidth: 1440,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
    },
  })
  win.setMenuBarVisibility(false)

  // ── 渲染进程崩溃 / 白屏自动恢复 ──
  // const reloadPage = () => {
  //   if (!win || win.isDestroyed()) return
  //   if (VITE_DEV_SERVER_URL) {
  //     win.loadURL(VITE_DEV_SERVER_URL)
  //   } else {
  //     win.loadFile(indexHtml)
  //   }
  // }


  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
    // 开发环境延迟较短
    setTimeout(() => {
      showMainWindow()
    }, 3500)
  } else {
    win.loadFile(indexHtml)
  }

  // 主窗口加载完成后显示
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
    
    // 生产环境下等待渲染完成后显示
    if (!VITE_DEV_SERVER_URL) {
      setTimeout(() => {
        showMainWindow()
      }, 800)
    }
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  // update(win)

}

app.whenReady().then(() => {
  registerProjectHandlers()
  registerCppSocketHandlers()
  registerKinematicsHandlers()
  registerConfigHandlers()
  registerToolHandlers()
  // 然后创建主窗口（在后台加载）
  createWindow()
})

app.on('before-quit', () => {
  shutdownCppSocket()
  shutdownKinematics()
})

app.on('will-quit', () => {
  shutdownCppSocket()
  shutdownKinematics()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

