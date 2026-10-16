import { ipcRenderer } from 'electron'
import { AI_BRIDGE_PORT_CHANNEL } from '../../shared/ai-bridge/protocol'
import type {
  AiRendererMessage,
  AiWriteRequest,
  AiWriteRequestMessage,
  AiWriteResponseMessage,
  AiWriteResult,
} from '../../shared/ai-bridge/types'

export type AiWriteHandler = (request: AiWriteRequest) => AiWriteResult | Promise<AiWriteResult>

/** 直连 ai-server 子进程的端口；main 在窗口加载完成 / 子进程重启后交过来 */
let port: MessagePort | null = null
/** 每类最新一条：换端口后补发，子进程重启无需渲染进程感知 */
const latest = new Map<AiRendererMessage['type'], AiRendererMessage>()
/** 界面注册的写入处理；工程文档在渲染进程 */
let writeHandler: AiWriteHandler | null = null

const answer = async (from: MessagePort, message: AiWriteRequestMessage): Promise<void> => {
  let result: AiWriteResult
  if (!writeHandler) {
    result = { ok: false, code: 'RENDERER_UNAVAILABLE', message: '软件界面尚未就绪' }
  } else {
    try {
      result = await writeHandler(message.request)
    } catch (err) {
      result = {
        ok: false,
        code: 'VALIDATION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }
  const response: AiWriteResponseMessage = { type: 'response', requestId: message.requestId, result }
  // 应答走请求进来的那个口；已换口时旧口已关，子进程那边也已按不可用结束
  from.postMessage(response)
}

ipcRenderer.on(AI_BRIDGE_PORT_CHANNEL, (event) => {
  const next = event.ports[0]
  if (!next) return
  port?.close()
  port = next
  next.onmessage = (incoming: MessageEvent<AiWriteRequestMessage>) => {
    if (incoming.data?.type === 'request') void answer(next, incoming.data)
  }
  for (const message of latest.values()) next.postMessage(message)
})

export const createAiBridgeApi = () => ({
  publish: (message: AiRendererMessage): void => {
    latest.set(message.type, message)
    port?.postMessage(message)
  },
  /** 注册写入处理，返回注销函数；同一时间只保留最后注册的一个 */
  onWriteRequest: (handler: AiWriteHandler): (() => void) => {
    writeHandler = handler
    return () => {
      if (writeHandler === handler) writeHandler = null
    }
  },
})
