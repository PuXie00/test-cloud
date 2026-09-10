import { ipcMain } from 'electron'
import { CONFIG_CHANNELS } from '../../../shared/config'
import { loadCatalog } from './load-catalog'

let registered = false

export const registerConfigHandlers = (): void => {
  if (registered) return
  registered = true

  ipcMain.handle(CONFIG_CHANNELS.getCatalog, async () => loadCatalog())
}
