import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import type { HaChunkAckMessage, HaChunkMessage } from '../../../shared/ha/protocol'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** 交给本机 C++ 的 HA|send；返回是否发出去了 */
export type HaRawSend = (to: string[], payload: unknown) => Promise<boolean>

export type HaTransportOptions = {
  /** 不超过这个大小（UTF-8 字节）的消息直接发；C++ 单条上限 1 MB，留出报文头 */
  singleLimitBytes: number
  /** 每块的字符数（gzip 后 base64，纯 ASCII） */
  chunkChars: number
  /** 发完一块等对方回的时间 */
  ackTimeoutMs: number
  /** 收的一方：一个传输这么久没有新块就丢掉 */
  idleTimeoutMs: number
  /** 还原后的最大字节数，防止坏数据撑爆内存 */
  maxMessageBytes: number
}

export const DEFAULT_HA_TRANSPORT_OPTIONS: HaTransportOptions = {
  singleLimitBytes: 900 * 1024,
  chunkChars: 768 * 1024,
  ackTimeoutMs: 15_000,
  idleTimeoutMs: 60_000,
  maxMessageBytes: 64 * 1024 * 1024,
}

type PendingAck = {
  peer: string
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

type Incoming = {
  total: number
  parts: (string | undefined)[]
  received: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * 两台前端之间的消息传输（方案 7.1）：
 * - 小消息直接用 HA|send 发；
 * - 大的（整份工程、模型文件）gzip 后切成小块，一块发完、等对方回了再发下一块，
 *   所以停止、动作状态这些小消息最多等一块。
 * 切块的消息还原后才交出去，和其它小消息之间不保证先后，调用方自己处理。
 */
export class HaTransport {
  private readonly opts: HaTransportOptions
  /** `${transferId}#${seq}` → 等对方回 */
  private readonly acks = new Map<string, PendingAck>()
  /** `${from}#${transferId}` → 收到的块 */
  private readonly incoming = new Map<string, Incoming>()

  constructor(
    private readonly rawSend: HaRawSend,
    opts: Partial<HaTransportOptions> = {},
  ) {
    this.opts = { ...DEFAULT_HA_TRANSPORT_OPTIONS, ...opts }
  }

  /** 发给 to 里的每一台；全部发成功返回 true */
  async send(to: string[], message: unknown): Promise<boolean> {
    if (to.length === 0) return true
    const text = JSON.stringify(message)
    if (Buffer.byteLength(text, 'utf8') <= this.opts.singleLimitBytes) {
      return this.rawSend(to, message)
    }
    const packed = (await gzipAsync(Buffer.from(text, 'utf8'))).toString('base64')
    const results = await Promise.all(to.map((peer) => this.sendChunked(peer, packed)))
    return results.every(Boolean)
  }

  private async sendChunked(peer: string, packed: string): Promise<boolean> {
    const { chunkChars } = this.opts
    const total = Math.max(1, Math.ceil(packed.length / chunkChars))
    const transferId = randomUUID()
    for (let seq = 0; seq < total; seq += 1) {
      const acked = this.waitAck(peer, transferId, seq)
      const chunk: HaChunkMessage = {
        type: 'chunk',
        transferId,
        seq,
        total,
        data: packed.slice(seq * chunkChars, (seq + 1) * chunkChars),
      }
      const sent = await this.rawSend([peer], chunk)
      if (!sent) {
        this.settleAck(`${transferId}#${seq}`, false)
        return false
      }
      if (!(await acked)) return false
    }
    return true
  }

  private waitAck(peer: string, transferId: string, seq: number): Promise<boolean> {
    const key = `${transferId}#${seq}`
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.settleAck(key, false), this.opts.ackTimeoutMs)
      this.acks.set(key, { peer, resolve, timer })
    })
  }

  private settleAck(key: string, ok: boolean): void {
    const pending = this.acks.get(key)
    if (!pending) return
    clearTimeout(pending.timer)
    this.acks.delete(key)
    pending.resolve(ok)
  }

  handleAck(from: string, ack: HaChunkAckMessage): void {
    const key = `${ack.transferId}#${ack.seq}`
    if (this.acks.get(key)?.peer !== from) return
    this.settleAck(key, true)
  }

  /** 收到一块：回一个 chunk-ack；收齐了返回还原的消息，没收齐或坏了返回 null */
  async receiveChunk(from: string, chunk: HaChunkMessage): Promise<unknown | null> {
    const key = `${from}#${chunk.transferId}`
    let entry = this.incoming.get(key)
    if (entry && entry.total !== chunk.total) {
      this.dropIncoming(key)
      return null
    }
    if (!entry) {
      entry = {
        total: chunk.total,
        parts: new Array<string | undefined>(chunk.total),
        received: 0,
        timer: this.idleTimer(key),
      }
      this.incoming.set(key, entry)
    } else {
      clearTimeout(entry.timer)
      entry.timer = this.idleTimer(key)
    }
    if (entry.parts[chunk.seq] === undefined) {
      entry.parts[chunk.seq] = chunk.data
      entry.received += 1
    }
    const ack: HaChunkAckMessage = { type: 'chunk-ack', transferId: chunk.transferId, seq: chunk.seq }
    void this.rawSend([from], ack)
    if (entry.received < entry.total) return null

    this.dropIncoming(key)
    try {
      const raw = await gunzipAsync(Buffer.from(entry.parts.join(''), 'base64'), {
        maxOutputLength: this.opts.maxMessageBytes,
      })
      return JSON.parse(raw.toString('utf8')) as unknown
    } catch {
      return null
    }
  }

  private idleTimer(key: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => this.dropIncoming(key), this.opts.idleTimeoutMs)
  }

  private dropIncoming(key: string): void {
    const entry = this.incoming.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    this.incoming.delete(key)
  }

  /** 和某台断开：发给它的传输失败，收它的丢掉 */
  dropPeer(peer: string): void {
    for (const [key, pending] of this.acks) {
      if (pending.peer === peer) this.settleAck(key, false)
    }
    for (const key of this.incoming.keys()) {
      if (key.startsWith(`${peer}#`)) this.dropIncoming(key)
    }
  }

  dispose(): void {
    for (const key of [...this.acks.keys()]) this.settleAck(key, false)
    for (const key of [...this.incoming.keys()]) this.dropIncoming(key)
  }

  /** 测试用：还在等的块、还没收齐的传输 */
  pendingCounts(): { acks: number; incoming: number } {
    return { acks: this.acks.size, incoming: this.incoming.size }
  }
}
