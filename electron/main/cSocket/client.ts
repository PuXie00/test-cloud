import WebSocket from 'ws'
import { buildEnvelope, parseEnvelope } from '../../../shared/csocket/codec'
import type {
  BuildEnvelopeInput,
  CppAckResult,
  CsocketConnectionState,
  CsocketMessageEvent,
  CsocketParseErrorEvent,
  CsocketResult,
  CsocketSendOpts2,
} from '../../../shared/csocket/types'

type TimerHandle = ReturnType<typeof setTimeout>

type PendingAck = {
  resolve: (result: CsocketResult<CppAckResult>) => void
  timer: TimerHandle
}

type MessageListener = (event: CsocketMessageEvent | CsocketParseErrorEvent) => void
type StatusListener = (status: CsocketConnectionState) => void

export type CppSocketClientOptions = {
  heartbeatIntervalMs?: number
  idleTimeoutMs?: number
  ackTimeoutMs?: number
  reconnectInitialMs?: number
  reconnectMaxMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
}

const OPEN = 1

const toMessageText = (data: unknown): string => {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'data' in data) {
    const inner = (data as { data: unknown }).data
    return typeof inner === 'string' ? inner : String(inner)
  }
  return String(data)
}

const withHeartCtx = (): BuildEnvelopeInput => ({
  OptCmd: 'HEART',
  addr: '',
  params: [],
})

export class CppSocketClient {
  private readonly heartbeatIntervalMs: number
  private readonly idleTimeoutMs: number
  private readonly ackTimeoutMs: number
  private readonly reconnectInitialMs: number
  private readonly reconnectMaxMs: number
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void

  private socket: WebSocket | null = null
  private url: string | undefined
  private manualClose = false
  private reconnectDelay: number
  private lastRxAt = 0
  private heartbeatTimer: TimerHandle | null = null
  private reconnectTimer: TimerHandle | null = null
  private readonly pending = new Map<string, PendingAck>()
  private readonly messageListeners = new Set<MessageListener>()
  private readonly statusListeners = new Set<StatusListener>()

  private status: CsocketConnectionState = { state: 'idle' }

  constructor(options: CppSocketClientOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15000
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10000
    this.reconnectInitialMs = options.reconnectInitialMs ?? 1000
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000
    this.now = options.now ?? (() => Date.now())
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
    this.reconnectDelay = this.reconnectInitialMs
  }

  getStatus(): CsocketConnectionState {
    return { ...this.status }
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  async connect(url: string): Promise<CsocketResult<void>> {
    if (this.socket?.readyState === OPEN && this.status.state === 'connected') {
      return { ok: true, data: undefined }
    }

    if (this.status.state === 'connecting') {
      return {
        ok: false,
        code: 'CONNECT_IN_PROGRESS',
        message: 'Connection already in progress',
      }
    }

    this.manualClose = false
    this.url = url
    this.clearReconnectTimer()
    this.setStatus({ state: 'connecting', url })

    return new Promise((resolve) => {
      let settled = false
      const settle = (result: CsocketResult<void>) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const failConnect = (message: string) => {
        if (settled) return
        if (this.socket === socket) {
          this.clearHeartbeatTimer()
          this.socket = null
        }
        this.setStatus({ state: 'disconnected', url, lastError: message })
        settle({ ok: false, code: 'CONNECT_FAILED', message })
        // 首次连不上也自动重试（C++ 可能尚未监听）
        if (!this.manualClose) {
          this.scheduleReconnect()
        }
      }

      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.setStatus({ state: 'disconnected', url, lastError: message })
        settle({ ok: false, code: 'CONNECT_FAILED', message })
        if (!this.manualClose) {
          this.scheduleReconnect()
        }
        return
      }

      this.socket = socket

      socket.on('open', () => {
        if (this.socket !== socket) return
        this.lastRxAt = this.now()
        console.log('socket open', url)
        this.reconnectDelay = this.reconnectInitialMs
        this.setStatus({
          state: 'connected',
          url,
          connectedAt: this.now(),
        })
        // this.startHeartbeat()
        settle({ ok: true, data: undefined })
      })

      socket.on('message', (...args: unknown[]) => {
        if (this.socket !== socket) return
        this.handleMessage(args[0])
      })

      socket.on('close', () => {
        if (!settled) {
          failConnect('Connection closed before open')
          return
        }
        if (this.socket !== socket) return
        this.handleClose()
      })

      socket.on('error', (...args: unknown[]) => {
        if (this.socket !== socket) return
        const err = args[0]
        const message = err instanceof Error ? err.message : String(err ?? 'WebSocket error')
        if (!settled) {
          failConnect(message)
          return
        }
        this.setStatus({ ...this.status, lastError: message })
      })
    })
  }

  async disconnect(): Promise<CsocketResult<void>> {
    this.manualClose = true
    this.clearHeartbeatTimer()
    this.clearReconnectTimer()
    this.rejectAllPending('DISCONNECTED', 'Connection closed')
    this.socket?.close()
    this.socket = null
    this.setStatus({ state: 'disconnected', url: this.url })
    return { ok: true, data: undefined }
  }

  async send(
    input: BuildEnvelopeInput,
    opts?: CsocketSendOpts2,
  ): Promise<CsocketResult<CppAckResult>> {
    if (!this.socket || this.socket.readyState !== OPEN || this.status.state !== 'connected') {
      return { ok: false, code: 'NOT_CONNECTED', message: 'WebSocket is not connected' }
    }
    const envelope = buildEnvelope({
      ...input,
    })
    try {
      console.log('send', JSON.stringify(envelope))
      this.socket.send(JSON.stringify(envelope))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, code: 'SEND_FAILED', message }
    }

    if (opts?.waitAck === false) {
      return { ok: true, data: { success: true } }
    }

    const timeoutMs = opts?.timeoutMs ?? this.ackTimeoutMs

    return new Promise((resolve) => {
      const timer = this.setTimer(() => {
        this.pending.delete(envelope.messageId)
        resolve({
          ok: false,
          code: 'ACK_TIMEOUT',
          message: `No ACK received within ${timeoutMs}ms for messageId ${envelope.messageId}`,
        })
      }, timeoutMs)

      this.pending.set(envelope.messageId, { resolve, timer })
    })
  }

  private handleMessage(raw: unknown) {
    this.lastRxAt = this.now()
    const text = toMessageText(raw)

    let envelope
    try {
      // console.log('text', text)
      envelope = parseEnvelope(text)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.emitMessage({ type: 'parseError', raw: text, error })
      return
    }
    if (envelope.OptCmd === 'HEART') return

    const pending = this.pending.get(envelope.messageId)
    if (pending) {
      this.clearTimer(pending.timer)
      this.pending.delete(envelope.messageId)
      pending.resolve({
        ok: true,
        data: envelope.result ?? { success: true },
      })
      return
    }


    this.emitMessage(envelope)
  }

  private handleClose() {
    this.clearHeartbeatTimer()
    this.socket = null
    this.rejectAllPending('DISCONNECTED', 'Connection lost')

    if (this.manualClose) {
      this.setStatus({ state: 'disconnected', url: this.url })
      return
    }

    this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.manualClose || !this.url) return

    this.setStatus({ state: 'reconnecting', url: this.url })

    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxMs)

    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      if (this.manualClose || !this.url) return
      void this.connect(this.url)
    }, delay)
  }

  private startHeartbeat() {
    this.clearHeartbeatTimer()
    this.heartbeatTimer = this.setTimer(() => this.heartbeatTick(), this.heartbeatIntervalMs)
  }

  private heartbeatTick() {
    if (this.manualClose || !this.socket || this.socket.readyState !== OPEN) return

    const idleMs = this.now() - this.lastRxAt
    if (idleMs > this.idleTimeoutMs) {
      this.socket.close()
      return
    }

    const ping = buildEnvelope(withHeartCtx())
    try {
      this.socket.send(JSON.stringify(ping))
    } catch {
      // ignore heartbeat send errors; close handler will reconnect
    }

    this.heartbeatTimer = this.setTimer(() => this.heartbeatTick(), this.heartbeatIntervalMs)
  }

  private rejectAllPending(code: string, message: string) {
    for (const [messageId, pending] of this.pending) {
      this.clearTimer(pending.timer)
      pending.resolve({ ok: false, code, message: `${message} (messageId: ${messageId})` })
    }
    this.pending.clear()
  }

  private clearHeartbeatTimer() {
    if (this.heartbeatTimer !== null) {
      this.clearTimer(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setStatus(next: CsocketConnectionState) {
    this.status = next
    for (const listener of this.statusListeners) {
      listener(this.getStatus())
    }
  }

  private emitMessage(event: CsocketMessageEvent | CsocketParseErrorEvent) {
    for (const listener of this.messageListeners) {
      listener(event)
    }
  }
}
