import { AI_WRITE_TIMEOUT_MS } from '../../shared/ai-bridge/protocol'
import type {
  AiWriteRequest,
  AiWriteRequestMessage,
  AiWriteResponseMessage,
  AiWriteResult,
} from '../../shared/ai-bridge/types'

export type AiRpcPort = { postMessage: (message: AiWriteRequestMessage) => void }

type Pending = {
  port: AiRpcPort
  resolve: (result: AiWriteResult) => void
  timer: ReturnType<typeof setTimeout>
}

const UNAVAILABLE: AiWriteResult = {
  ok: false,
  code: 'RENDERER_UNAVAILABLE',
  message: '软件界面未连接（刚启动或正在刷新），稍后重试',
}

/**
 * 写入请求经渲染进程直连口转给界面执行（工程文档与校验都在渲染进程），按 requestId 等应答。
 * 换口或断开时，挂在旧口上的请求立即按界面不可用结束。
 */
export class AiRendererRpc {
  private port: AiRpcPort | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly timeoutMs: number = AI_WRITE_TIMEOUT_MS) {}

  get connected(): boolean {
    return this.port !== null
  }

  attach(port: AiRpcPort): void {
    if (this.port && this.port !== port) this.failPort(this.port)
    this.port = port
  }

  detach(port: AiRpcPort): void {
    if (this.port !== port) return
    this.port = null
    this.failPort(port)
  }

  request(request: AiWriteRequest): Promise<AiWriteResult> {
    const port = this.port
    if (!port) return Promise.resolve(UNAVAILABLE)
    const requestId = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ ok: false, code: 'TIMEOUT', message: '软件界面未及时应答' })
      }, this.timeoutMs)
      this.pending.set(requestId, { port, resolve, timer })
      port.postMessage({ type: 'request', requestId, request })
    })
  }

  settle(message: AiWriteResponseMessage): void {
    const entry = this.pending.get(message.requestId)
    if (!entry) return
    this.pending.delete(message.requestId)
    clearTimeout(entry.timer)
    entry.resolve(message.result)
  }

  private failPort(port: AiRpcPort): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.port !== port) continue
      this.pending.delete(requestId)
      clearTimeout(entry.timer)
      entry.resolve(UNAVAILABLE)
    }
  }
}
