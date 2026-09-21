import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { DEFAULT_KINEMATICS_EXE, KINEMATICS_PORT } from '../../../shared/kinematics/protocol'
import { resolveKinematicsExePathFrom } from '../../../shared/kinematics/resolve-exe'
import { parseListeningPids } from './parse-port'

let child: ChildProcess | null = null
let stopping = false

export const resolveKinematicsCwd = (): string => path.dirname(resolveKinematicsExePath())

export const resolveKinematicsExePath = (): string =>
  resolveKinematicsExePathFrom({
    exeName: process.env.YZ_KINEMATICS_EXE?.trim() || DEFAULT_KINEMATICS_EXE,
    appDir: path.dirname(app.getPath('exe')),
    appRoot: process.env.APP_ROOT?.trim(),
    override: process.env.YZ_KINEMATICS_PATH?.trim(),
    exists: (filePath) => fs.existsSync(filePath),
  })

export const isKinematicsRunning = (): boolean =>
  Boolean(child?.pid && !child.killed)

export const startKinematicsRuntime = ():
  | { ok: true; path: string; pid: number; cwd: string }
  | { ok: false; code: 'EXE_NOT_FOUND' | 'SPAWN_FAILED'; message: string } => {
  if (isKinematicsRunning()) {
    return {
      ok: true,
      path: resolveKinematicsExePath(),
      pid: child!.pid!,
      cwd: resolveKinematicsCwd(),
    }
  }

  const exePath = resolveKinematicsExePath()
  if (!fs.existsSync(exePath)) {
    return { ok: false, code: 'EXE_NOT_FOUND', message: `Kinematics exe not found: ${exePath}` }
  }

  try {
    freeForeignPortListeners(KINEMATICS_PORT)
    const cwd = resolveKinematicsCwd()
    child = spawn(exePath, [], {
      cwd,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    })
    const pid = child.pid
    if (!pid) {
      child = null
      return { ok: false, code: 'SPAWN_FAILED', message: 'spawn returned no pid' }
    }
    child.on('error', (err) => {
      console.error(`[kinematics] error: ${err.message}`)
      child = null
    })
    child.on('exit', (code, signal) => {
      if (!stopping) {
        console.warn(`[kinematics] exited code=${code} signal=${signal}`)
      }
      child = null
    })
    console.info(`[kinematics] started pid=${pid} path=${exePath} cwd=${cwd}`)
    return { ok: true, path: exePath, pid, cwd }
  } catch (err) {
    child = null
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'SPAWN_FAILED', message }
  }
}

const freeForeignPortListeners = (port: number): void => {
  if (process.platform !== 'win32') return
  let output = ''
  try {
    output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
  } catch (err) {
    console.error(`[kinematics] netstat failed: ${String(err)}`)
    return
  }
  for (const pid of parseListeningPids(output, port)) {
    if (child?.pid === pid) continue
    console.warn(`[kinematics] freeing port ${port} pid=${pid}`)
    killWindowsTree(pid)
  }
}

const killWindowsTree = (pid: number): void => {
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
  } catch {
    /* already gone */
  }
}

const killKinematicsImage = (): void => {
  if (process.platform !== 'win32') return
  const exeName = path.basename(resolveKinematicsExePath())
  if (!exeName) return
  try {
    execFileSync('taskkill', ['/IM', exeName, '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
  } catch {
    /* none running */
  }
}

export const stopKinematicsRuntime = (): void => {
  stopping = true
  const pid = child?.pid
  const proc = child
  child = null
  try {
    if (process.platform === 'win32') {
      if (pid) killWindowsTree(pid)
      freeForeignPortListeners(KINEMATICS_PORT)
      killKinematicsImage()
    } else if (proc) {
      proc.kill('SIGTERM')
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 2000).unref?.()
    }
  } catch (err) {
    console.error(`[kinematics] stop failed: ${String(err)}`)
  } finally {
    stopping = false
  }
}
