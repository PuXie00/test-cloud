import { registerKinematicsIpc } from './ipc'
import { shutdownKinematics } from './client'

export const registerKinematicsHandlers = (): void => {
  registerKinematicsIpc()
}

export { shutdownKinematics }
