import { registerKinematicsIpc } from './ipc'
import { shutdownKinematics } from './client'
import { startKinematicsRuntime } from './process'

/** 与 C++ 运行时一样，软件启动时拉起耦合反解程序。找不到 exe 只记日志，不阻断主界面。 */
export const registerKinematicsHandlers = (): void => {
  registerKinematicsIpc()

  const started = startKinematicsRuntime()
  if (!started.ok) {
    console.warn(`[kinematics] ${started.code}: ${started.message}`)
    return
  }
  console.info(`[kinematics] runtime ready pid=${started.pid}`)
}

export { shutdownKinematics }
