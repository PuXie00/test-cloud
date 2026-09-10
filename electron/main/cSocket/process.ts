import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** 可被环境变量覆盖：YZ_CPP_RUNTIME_EXE / YZ_CPP_RUNTIME_PATH */
export const DEFAULT_CPP_RUNTIME_EXE = 'YzRuntime.exe'

const CONSOLE_TITLE = 'YzRuntime'

let child: ChildProcess | null = null
let stopping = false

export const resolveCppRuntimePath = (): string => {
  const override = process.env.YZ_CPP_RUNTIME_PATH?.trim()
  if (override) return path.resolve(override)

  const exeName = process.env.YZ_CPP_RUNTIME_EXE?.trim() || DEFAULT_CPP_RUNTIME_EXE
  const appDir = path.dirname(app.getPath('exe'))
  const appRoot = process.env.APP_ROOT ?? ''
  const candidates = [
    path.join(appDir, exeName),
    appRoot ? path.join(appRoot, exeName) : '',
    appRoot ? path.join(appRoot, 'Runtime', exeName) : '',
    path.join(appDir, 'Runtime', exeName),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] ?? path.join(appDir, exeName)
}

export const isCppRuntimeRunning = (): boolean =>
  Boolean(child?.pid && !child.killed)

const isDebugBuild = process.env.BUILD_MODE === 'debug'

const spawnCppRuntime = (exePath: string, cwd: string): ChildProcess => {
  if (process.platform !== 'win32') {
    return spawn(exePath, [], {
      cwd,
      stdio: isDebugBuild ? 'inherit' : 'ignore',
      detached: false,
    })
  }

  if (!isDebugBuild) {
    return spawn(exePath, [], {
      cwd,
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    })
  }

  const comspec = process.env.ComSpec || 'cmd.exe'
  const quotedCwd = `"${cwd.replace(/"/g, '')}"`
  const quotedExe = `"${exePath.replace(/"/g, '')}"`
  // `start "title"` must be quoted or `start` treats the next token as the exe name.
  // `/WAIT` keeps this cmd alive so we still have a pid to kill on quit.
  // Inner `cmd /c` (not `/k`) closes the console when the exe exits.
  return spawn(
    comspec,
    ['/d', '/s', '/c', `start "${CONSOLE_TITLE}" /WAIT /D ${quotedCwd} cmd /c ${quotedExe}`],
    {
      windowsHide: false,
      windowsVerbatimArguments: true,
      detached: false,
      stdio: 'ignore',
    },
  )
}

export const startCppRuntime = (): { ok: true; path: string; pid: number } | { ok: false; code: string; message: string } => {
  if (isCppRuntimeRunning()) {
    return { ok: true, path: resolveCppRuntimePath(), pid: child!.pid! }
  }

  const exePath = resolveCppRuntimePath()
  if (!fs.existsSync(exePath)) {
    return {
      ok: false,
      code: 'EXE_NOT_FOUND',
      message: `C++ runtime not found: ${exePath}`,
    }
  }

  try {
    child = spawnCppRuntime(exePath, path.dirname(exePath))
    const pid = child.pid
    if (!pid) {
      child = null
      return { ok: false, code: 'SPAWN_FAILED', message: 'spawn returned no pid' }
    }

    child.on('error', (err) => {
      console.error(`[cSocket] cpp runtime error: ${err.message}`)
      child = null
    })
    child.on('exit', (code, signal) => {
      if (!stopping) {
        console.warn(`[cSocket] cpp runtime exited code=${code} signal=${signal}`)
      }
      child = null
    })

    console.info(`[cSocket] cpp runtime started pid=${pid} path=${exePath}`)
    return { ok: true, path: exePath, pid }
  } catch (err) {
    child = null
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, code: 'SPAWN_FAILED', message }
  }
}

const taskkillSync = (args: string[]): void => {
  try {
    execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 8000 })
  } catch {
    /* already gone */
  }
}

export const stopCppRuntime = (): void => {
  stopping = true
  const pid = child?.pid
  const proc = child
  child = null

  try {
    if (process.platform === 'win32') {
      if (pid) taskkillSync(['/pid', String(pid), '/T', '/F'])
      taskkillSync(['/FI', `WINDOWTITLE eq ${CONSOLE_TITLE}*`, '/T', '/F'])
      taskkillSync(['/im', DEFAULT_CPP_RUNTIME_EXE, '/T', '/F'])
    } else if (proc) {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error(`[cSocket] stop cpp runtime failed: ${String(err)}`)
  } finally {
    stopping = false
  }
}
