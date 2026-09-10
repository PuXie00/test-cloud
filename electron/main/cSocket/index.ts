import { CsocketApiService } from './api'
import { CppSocketClient } from './client'
import { registerCppSocketIpc } from './ipc'
import { startCppRuntime, stopCppRuntime } from './process'

/** 可用环境变量 YZ_CPP_WS_URL 覆盖 */
// export const DEFAULT_CPP_WS_URL = 'ws://192.168.82.105:8080'
export const DEFAULT_CPP_WS_URL = 'ws://127.0.0.1:8080'

/** C++ 进程起来后再连，给监听端口一点时间 */
const CONNECT_AFTER_SPAWN_MS = 3000

let client: CppSocketClient | null = null
let api: CsocketApiService | null = null
let connectKickTimer: ReturnType<typeof setTimeout> | null = null

export const resolveCppWsUrl = (): string =>
  process.env.YZ_CPP_WS_URL?.trim() || DEFAULT_CPP_WS_URL

export const getCppSocketClient = (): CppSocketClient => {
  if (!client) client = new CppSocketClient()
  return client
}

export const getCsocketApiService = (): CsocketApiService => {
  if (!api) {
    api = new CsocketApiService(getCppSocketClient())
  }
  return api
}

const clearConnectKickTimer = () => {
  if (connectKickTimer !== null) {
    clearTimeout(connectKickTimer)
    connectKickTimer = null
  }
}

/** 主进程常驻连接：不暴露给 UI；失败由 client 指数退避重连 */
const startPersistentConnection = (url: string): void => {
  clearConnectKickTimer()
  connectKickTimer = setTimeout(() => {
    connectKickTimer = null
    void getCppSocketClient()
      .connect(url)
      .then((result) => {
        if (result.ok) {
          console.info(`[cSocket] connected ${url}`)
          return
        }
        console.warn(`[cSocket] connect pending/retry: ${result.code} ${result.message}`)
      })
      .catch((err) => {
        console.warn(`[cSocket] connect error: ${String(err)}`)
      })
  }, CONNECT_AFTER_SPAWN_MS)
}

/** 注册业务 IPC，启动 C++ 运行时并建立常驻 WebSocket */
export const registerCppSocketHandlers = (): void => {
  registerCppSocketIpc(getCsocketApiService())

  const started = startCppRuntime()
  if (!started.ok) {
    console.warn(`[cSocket] ${started.code}: ${started.message}`)
  } else {
    console.info(`[cSocket] cpp runtime ready pid=${started.pid}`)
  }

  startPersistentConnection(resolveCppWsUrl())
}

export const shutdownCppSocket = (): void => {
  clearConnectKickTimer()
  void getCppSocketClient().disconnect()
  stopCppRuntime()
}

export { CppSocketClient, CsocketApiService, startCppRuntime, stopCppRuntime }
