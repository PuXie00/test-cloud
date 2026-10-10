import type { MessagePortMain } from 'electron'
import { AI_HTTP_DEFAULT_PORT, AI_HTTP_HOST } from '../../shared/ai-bridge/protocol'
import type { AiChildMessage, AiMainMessage, AiRendererMessage } from '../../shared/ai-bridge/types'
import { createAiHttpServer } from './http'
import { AiBridgeStore } from './store'

/**
 * utilityProcess 入口：给本地 AI 的只读 HTTP 服务。
 * main 推设备状态，渲染进程经直连 MessagePort 推界面状态与工程配置；请求只读内存。
 */

const parsePort = (argv: readonly string[]): number => {
  const raw = argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length)
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : AI_HTTP_DEFAULT_PORT
}

const parent = process.parentPort
const store = new AiBridgeStore()
let rendererPort: MessagePortMain | null = null

const postParent = (message: AiChildMessage): void => {
  parent.postMessage(message)
}

const attachRendererPort = (port: MessagePortMain | undefined): void => {
  if (!port) return
  rendererPort?.close()
  rendererPort = port
  store.resetRenderer()
  store.rendererConnected = true
  port.on('message', (event) => {
    if (rendererPort !== port) return
    store.applyRenderer(event.data as AiRendererMessage)
  })
  port.on('close', () => {
    if (rendererPort !== port) return
    rendererPort = null
    store.rendererConnected = false
  })
  port.start()
}

parent.on('message', (event) => {
  const message = event.data as AiMainMessage
  if (message?.type === 'renderer-port') {
    attachRendererPort(event.ports[0])
    return
  }
  if (message?.type === 'status') store.applyStatus(message.delta)
})

const port = parsePort(process.argv)
const server = createAiHttpServer(store)

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[ai-server] listen failed: ${err.message}`)
  postParent({ type: 'listen-error', code: err.code ?? 'LISTEN_FAILED', message: err.message })
  // 留时间把消息送到 main；之后由 main 退避重启
  setTimeout(() => process.exit(1), 100)
})

server.listen(port, AI_HTTP_HOST, () => {
  console.info(`[ai-server] listening http://${AI_HTTP_HOST}:${port}`)
  postParent({ type: 'listening', host: AI_HTTP_HOST, port })
})
