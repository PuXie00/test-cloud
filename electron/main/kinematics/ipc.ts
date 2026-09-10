import { ipcMain } from 'electron'
import { KINEMATICS_CHANNELS } from '../../../shared/kinematics/channels'
import { solveKinematics } from './client'

let registered = false

export const registerKinematicsIpc = (): void => {
  if (registered) return
  registered = true
  ipcMain.handle(KINEMATICS_CHANNELS.solve, async (_e, items: unknown[]) => solveKinematics(items))
}
