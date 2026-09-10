import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  KINEMATICS_CALL_FILE,
  KINEMATICS_HOST,
  KINEMATICS_PORT,
  KINEMATICS_RESULT_FILE,
  KINEMATICS_SOLVE_TIMEOUT_MS,
  KINEMATICS_START_TIMEOUT_MS,
} from '../../../shared/kinematics/protocol'
import {
  buildKinematicsCallFile,
  parseKinematicsResultFile,
} from '../../../shared/kinematics/parse-result'
import type { KinematicsSolveResult } from '../../../shared/kinematics/types'
import {
  isKinematicsRunning,
  resolveKinematicsCwd,
  startKinematicsRuntime,
  stopKinematicsRuntime,
} from './process'

const startTimeoutMs = (): number => {
  const raw = process.env.YZ_KINEMATICS_START_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : KINEMATICS_START_TIMEOUT_MS
}

const solveTimeoutMs = (): number => {
  const raw = process.env.YZ_KINEMATICS_SOLVE_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : KINEMATICS_SOLVE_TIMEOUT_MS
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const STABLE_CONNECT_MS = 400

let socket: net.Socket | null = null
let queue: Promise<unknown> = Promise.resolve()
let triggerSeq = 1

const err = (
  code: Extract<KinematicsSolveResult, { ok: false }>['code'],
  message: string,
): KinematicsSolveResult => ({ ok: false, code, message })

const dropSocket = (): void => {
  if (!socket) return
  socket.removeAllListeners()
  socket.destroy()
  socket = null
}

const connectOnce = (host: string, port: number): Promise<net.Socket | null> =>
  new Promise((resolve) => {
    const next = net.connect({ host, port })
    const onError = () => {
      next.off('connect', onConnect)
      next.destroy()
      resolve(null)
    }
    const onConnect = () => {
      next.off('error', onError)
      resolve(next)
    }
    next.once('error', onError)
    next.once('connect', onConnect)
  })

const waitForStableConnection = async (
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const opened = await connectOnce(host, port)
    if (opened) {
      await sleep(STABLE_CONNECT_MS)
      if (!opened.destroyed) return opened
      opened.destroy()
    }
    await sleep(200)
  }
  throw Object.assign(new Error(`port ${host}:${port} not ready`), { code: 'START_TIMEOUT' as const })
}

const attachSocket = (next: net.Socket): void => {
  dropSocket()
  socket = next
  socket.setNoDelay(true)
  socket.on('close', () => {
    if (socket === next) socket = null
  })
}

const readReply = (expected: Buffer, timeoutMs: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (!socket) {
      reject(Object.assign(new Error('not connected'), { code: 'PROTOCOL_ERROR' as const }))
      return
    }
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      cleanup()
      reject(Object.assign(new Error('solve timed out'), { code: 'SOLVE_TIMEOUT' as const }))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      const buf = Buffer.concat(chunks)
      if (buf.equals(expected)) {
        cleanup()
        resolve(buf)
        return
      }
      const text = buf.toString('utf8')
      if (text.startsWith('{')) {
        try {
          JSON.parse(text)
          cleanup()
          resolve(buf)
        } catch {
          /* incomplete json */
        }
      }
    }
    const onClose = () => {
      cleanup()
      reject(Object.assign(new Error('connection closed'), { code: 'PROTOCOL_ERROR' as const }))
    }
    const cleanup = () => {
      clearTimeout(timer)
      socket?.off('data', onData)
      socket?.off('close', onClose)
      socket?.off('error', onClose)
    }
    socket.on('data', onData)
    socket.on('close', onClose)
    socket.on('error', onClose)
  })

const ensureSocket = async (): Promise<KinematicsSolveResult | null> => {
  if (!isKinematicsRunning()) {
    dropSocket()
    const started = startKinematicsRuntime()
    if (!started.ok) return err(started.code, started.message)
    try {
      const opened = await waitForStableConnection(
        KINEMATICS_HOST,
        KINEMATICS_PORT,
        startTimeoutMs(),
      )
      attachSocket(opened)
    } catch {
      return err(
        'START_TIMEOUT',
        `Kinematics exe did not listen on ${KINEMATICS_HOST}:${KINEMATICS_PORT}`,
      )
    }
    return null
  }

  if (socket && !socket.destroyed) return null

  const opened = await connectOnce(KINEMATICS_HOST, KINEMATICS_PORT)
  if (!opened) return err('PROTOCOL_ERROR', 'failed to connect kinematics TCP')
  attachSocket(opened)
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const writeCallFile = async (items: unknown[]): Promise<string> => {
  const cwd = resolveKinematicsCwd()
  const callPath = path.join(cwd, KINEMATICS_CALL_FILE)
  const body = buildKinematicsCallFile(items, cwd)
  const handle = await fs.open(callPath, 'w')
  try {
    await handle.writeFile(`${JSON.stringify(body, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  console.info(`[kinematics] wrote ${callPath}`)
  return path.join(cwd, KINEMATICS_RESULT_FILE)
}

const solveOnce = async (items: unknown[]): Promise<KinematicsSolveResult> => {
  let resultPath: string
  try {
    resultPath = await writeCallFile(items)
  } catch (caught) {
    return err('PROTOCOL_ERROR', caught instanceof Error ? caught.message : String(caught))
  }

  const connectErr = await ensureSocket()
  if (connectErr) return connectErr
  if (!socket) return err('PROTOCOL_ERROR', 'socket missing')

  const trigger = String(triggerSeq++)
  const triggerBuf = Buffer.from(trigger, 'utf8')
  socket.write(triggerBuf)

  let reply: Buffer
  try {
    reply = await readReply(triggerBuf, solveTimeoutMs())
  } catch (caught) {
    dropSocket()
    const code = isRecord(caught) && caught.code === 'SOLVE_TIMEOUT' ? 'SOLVE_TIMEOUT' : 'PROTOCOL_ERROR'
    return err(code, caught instanceof Error ? caught.message : String(caught))
  }

  if (!reply.equals(triggerBuf)) {
    let message = reply.toString('utf8')
    try {
      const parsed = JSON.parse(message) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      /* keep raw */
    }
    return err('PROTOCOL_ERROR', message)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(resultPath, 'utf8'))
  } catch {
    return err('INVALID_RESULT', `failed to read ${KINEMATICS_RESULT_FILE}`)
  }
  return parseKinematicsResultFile(parsed, items.length)
}

export const solveKinematics = (items: unknown[]): Promise<KinematicsSolveResult> => {
  const run = queue.then(() => solveOnce(items), () => solveOnce(items))
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export const shutdownKinematics = (): void => {
  dropSocket()
  stopKinematicsRuntime()
}
