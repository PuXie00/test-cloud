import { app, BrowserWindow, shell, Menu, screen } from 'electron'
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

// ──────────────────────────────────────────────
// 文件日志（写入安装目录下的 monitor-error.log）
// ──────────────────────────────────────────────
const LOG_FILE = path.join(path.dirname(app.getPath('exe')), 'monitor-error.log')
const LOG_MAX_BYTES = 2 * 1024 * 1024 // 2 MB 后自动轮转

const writeLog = (level: 'ERROR' | 'WARN' | 'INFO', message: string): void => {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
  try {
    // 超过上限时将旧日志重命名为 .old 再重新写
    const stat = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null
    if (stat && stat.size > LOG_MAX_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE.replace('.log', '.old.log'))
    }
    fs.appendFileSync(LOG_FILE, line, 'utf8')
  } catch {
    // 写入失败时只打印到控制台，避免循环
  }
  console.error(line.trimEnd())
}

// 捕获主进程未处理异常
process.on('uncaughtException', (err) => {
  writeLog('ERROR', `uncaughtException: ${err.stack ?? err.message}`)
})
process.on('unhandledRejection', (reason) => {
  writeLog('ERROR', `unhandledRejection: ${String(reason)}`)
})

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

  const { x, y, width, height } = screen.getPrimaryDisplay().bounds

  win = new BrowserWindow({
    title: '租赁舞台控制系统',
    fullscreen: process.platform !== 'win32',
    width,
    height,
    resizable: false,
    show: false,
    frame: false,
    x,
    y,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
    },
  })

  // 强制隐藏菜单栏（Linux 下 autoHideMenuBar 仍会短暂显示）
  win.setMenuBarVisibility(false)

  // Windows: 先定位到主屏再全屏
  if (process.platform === 'win32') {
    win.setBounds({ x, y, width, height })
    win.maximize()
  }

  // 禁止退出全屏
  win.on('leave-full-screen', () => {
    win?.setFullScreen(true)
  })

  // ── 渲染进程崩溃 / 白屏自动恢复 ──
  // const reloadPage = () => {
  //   if (!win || win.isDestroyed()) return
  //   if (VITE_DEV_SERVER_URL) {
  //     win.loadURL(VITE_DEV_SERVER_URL)
  //   } else {
  //     win.loadFile(indexHtml)
  //   }
  // }

  win.webContents.on('render-process-gone', (_event, details) => {
    writeLog('ERROR', `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`)
    // setTimeout(reloadPage, 1000)
  })

  win.on('unresponsive', () => {
    writeLog('WARN', 'window unresponsive')
    // reloadPage()
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return // ERR_ABORTED: 页面跳转时的正常中止，忽略
    writeLog('ERROR', `did-fail-load: code=${errorCode} desc=${errorDescription}`)
    // setTimeout(reloadPage, 2000)
  })

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

