import { ipcRenderer } from 'electron'
import { KINEMATICS_CHANNELS } from '../../shared/kinematics/channels'
import type { KinematicsSolveResult } from '../../shared/kinematics/types'

export const createKinematicsApi = () => ({
  solve: (items: unknown[]): Promise<KinematicsSolveResult> =>
    ipcRenderer.invoke(KINEMATICS_CHANNELS.solve, items) as Promise<KinematicsSolveResult>,
})
