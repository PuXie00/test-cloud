import { app } from 'electron'
import path from 'node:path'

export const getInstallDir = (): string => path.dirname(app.getPath('exe'))

/** YZ_CONFIGS_ROOT override; else APP_ROOT/Configs (dev) or <installDir>/Configs (packaged) */
export const getConfigsRoot = (): string => {
  const override = process.env.YZ_CONFIGS_ROOT?.trim()
  if (override) return path.resolve(override)
  if (!app.isPackaged) {
    const appRoot = process.env.APP_ROOT?.trim()
    if (appRoot) return path.join(path.resolve(appRoot), 'Configs')
  }
  return path.join(getInstallDir(), 'Configs')
}
