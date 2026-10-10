import { ipcRenderer } from 'electron'
import { AI_BRIDGE_PORT_CHANNEL } from '../../shared/ai-bridge/protocol'
import type { AiRendererMessage } from '../../shared/ai-bridge/types'

/** 直连 ai-server 子进程的端口；main 在窗口加载完成 / 子进程重启后交过来 */
let port: MessagePort | null = null
/** 每类最新一条：换端口后补发，子进程重启无需渲染进程感知 */
const latest = new Map<AiRendererMessage['type'], AiRendererMessage>()

ipcRenderer.on(AI_BRIDGE_PORT_CHANNEL, (event) => {
  const next = event.ports[0]
  if (!next) return
  port?.close()
  port = next
  for (const message of latest.values()) port.postMessage(message)
})

export const createAiBridgeApi = () => ({
  publish: (message: AiRendererMessage): void => {
    latest.set(message.type, message)
    port?.postMessage(message)
  },
})
