import path from 'node:path'
import { MessageChannelMain, type BrowserWindow } from 'electron'
import { AI_BRIDGE_PORT_CHANNEL, AI_HTTP_DEFAULT_PORT } from '../../../shared/ai-bridge/protocol'
import { getCsocketApiService } from '../cSocket'
import { AiServerProcess } from './process'
import { AiStatusForwarder } from './status-forwarder'

let server: AiServerProcess | null = null
const windows = new Set<BrowserWindow>()

const forwarder = new AiStatusForwarder((delta) => {
  server?.post({ type: 'status', delta })
})

/** 可用环境变量 YZ_AI_HTTP_PORT 覆盖 */
export const resolveAiHttpPort = (): number => {
  const port = Number(process.env.YZ_AI_HTTP_PORT?.trim())
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : AI_HTTP_DEFAULT_PORT
}

const resolveEntry = (): string =>
  path.join(process.env.APP_ROOT, 'dist-electron', 'main', 'ai-server.js')

/** 建一条 渲染进程 ↔ 子进程 直连通道，界面数据不经 main 转发 */
const handRendererPort = (win: BrowserWindow): void => {
  if (win.isDestroyed() || !server) return
  const { port1, port2 } = new MessageChannelMain()
  if (!server.post({ type: 'renderer-port' }, [port1])) {
    port1.close()
    port2.close()
    return
  }
  win.webContents.postMessage(AI_BRIDGE_PORT_CHANNEL, null, [port2])
}

/** 启动本地 AI 只读 HTTP 服务（utilityProcess），并订阅 cSocket 设备状态。失败只记日志 */
export const registerAiBridgeHandlers = (): void => {
  if (server) return
  server = new AiServerProcess(resolveEntry(), resolveAiHttpPort(), () => {
    server?.post({ type: 'status', delta: forwarder.snapshot() })
    for (const win of windows) {
      if (!win.isDestroyed() && !win.webContents.isLoading()) handRendererPort(win)
    }
  })

  getCsocketApiService().setStatusSink({
    connection: (state) => forwarder.setConnection(state),
    plcs: (snapshot) => forwarder.setPlcs(snapshot),
    models: (items) => forwarder.upsertObjects(items),
    axes: (items) => forwarder.upsertMotors(items),
    actions: (result) => forwarder.ingestActions(result),
    clear: (kind) => forwarder.clear(kind),
  })

  server.start()
}

/** 窗口每次加载完成（含刷新）都重新交一次端口；preload 会把最新数据补发过去 */
export const attachAiBridgeWindow = (win: BrowserWindow): void => {
  windows.add(win)
  win.webContents.on('did-finish-load', () => handRendererPort(win))
  win.on('closed', () => windows.delete(win))
}

export const shutdownAiBridge = (): void => {
  forwarder.dispose()
  server?.stop()
}
