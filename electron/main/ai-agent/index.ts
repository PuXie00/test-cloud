import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const AI_AGENT_DIR = 'AiAgent'
const AI_AGENT_ENTRY = path.join('dist', 'main.js')

const verbose = Boolean(process.env.VITE_DEV_SERVER_URL) || process.env.IS_DEBUG === 'true'

let child: ChildProcess | null = null

/** IS_DEV 用项目目录 AiAgent，否则用安装目录 AiAgent */
export const resolveAiAgentDir = (): string => {
  const installDir = path.dirname(app.getPath('exe'))
  const base = process.env.IS_DEV === 'true'
    ? process.env.APP_ROOT?.trim() || installDir
    : installDir
  return path.join(base, AI_AGENT_DIR)
}

/**
 * 用本进程的可执行文件当 Node（ELECTRON_RUN_AS_NODE），现场不用另装 Node。
 * Electron 钉在 44.7.0：AiAgent 的 node-addon-require-builtin 按 V8 指纹放行，只认 44.7.0 的 15.2.124.28-electron.0。44.7.1 起 V8 已变，再升会启动失败。
 */
const electronNodeEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
})

/** 软件启动时拉起 AI Agent（node dist/main.js）。.env 按当前目录读，cwd 必须是 AiAgent 目录。失败只记日志 */
export const startAiAgent = (): void => {
  if (child) return
  const cwd = resolveAiAgentDir()
  const entry = path.join(cwd, AI_AGENT_ENTRY)
  if (!fs.existsSync(entry)) {
    console.warn(`[ai-agent] entry not found: ${entry}`)
    return
  }

  const proc = spawn(process.execPath, [entry], {
    cwd,
    env: electronNodeEnv(),
    windowsHide: true,
    detached: false,
    stdio: verbose ? 'inherit' : 'ignore',
  })
  child = proc

  proc.on('error', (err) => {
    console.error(`[ai-agent] spawn failed: ${err.message}`)
    if (child === proc) child = null
  })
  proc.on('exit', (code, signal) => {
    if (child !== proc) return
    child = null
    console.warn(`[ai-agent] exited code=${code} signal=${signal}`)
  })
  if (proc.pid) console.info(`[ai-agent] started pid=${proc.pid} entry=${entry}`)
}

/** 连同 Agent 拉起的子进程一起关；退出和升级前都会调，重复调用无副作用 */
export const shutdownAiAgent = (): void => {
  const proc = child
  child = null
  if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 8000,
      })
    } catch {
      /* already gone */
    }
    return
  }

  proc.kill('SIGTERM')
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
  }, 2000).unref()
}
