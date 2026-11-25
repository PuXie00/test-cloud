import { app, BrowserWindow, ipcMain } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { HaAppMessage } from '../../../shared/ha/protocol'
import { HA_CHANNELS, type HaState, type HaSyncRecord, type HaSyncScope } from '../../../shared/ha/types'
import { PROJECT_FORMAT_VERSION } from '../../../shared/project/project-format'
import type { CsocketApiService } from '../cSocket/api'
import { onProjectFileEvent } from '../project/file-events'
import { onCurrentProjectChange } from '../project/service'
import { createProjectFilesPort } from './files'
import { backupBeforeOverwrite, createSyncRecordStore, writeSyncedParts, type HaSyncedParts } from './project-io'
import { HaService, type HaBusyEntry } from './service'
import { createFileHaSettingsStorage, listLocalIpv4 } from './storage'

/** 热备设置跟着电脑走，存在本机用户数据目录；可用 YZ_HA_SETTINGS_FILE 覆盖 */
export const getHaSettingsFilePath = (): string => {
  const override = process.env.YZ_HA_SETTINGS_FILE?.trim()
  if (override) return path.resolve(override)
  return path.join(app.getPath('userData'), 'ha-settings.json')
}

let service: HaService | null = null

const broadcast = (channel: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const broadcastState = (state: HaState): void => broadcast(HA_CHANNELS.state, state)

/** 主备热备：接进本机 C++ 的指令收发和推送，注册界面用的 IPC。每次启动软件热备都是关的 */
export const registerHaHandlers = (csocket: CsocketApiService): void => {
  if (service) return
  const ha = new HaService({
    csocket: {
      haStart: (params) => csocket.haStart(params),
      haStop: () => csocket.haStop(),
      haSend: (to, payload) => csocket.haSend(to, payload),
      sendForwarded: (envelope) => csocket.sendForwarded(envelope),
    },
    storage: createFileHaSettingsStorage(getHaSettingsFilePath()),
    defaultHostName: os.hostname(),
    onState: broadcastState,
    onAppMessage: (from, message) => broadcast(HA_CHANNELS.message, { from, message }),
    onBlocked: (optCmd, reason) => broadcast(HA_CHANNELS.blocked, { optCmd, reason }),
    files: createProjectFilesPort(),
    onModelsChanged: () => broadcast(HA_CHANNELS.modelsChanged, null),
    log: (message) => console.info(message),
  })
  service = ha
  const records = createSyncRecordStore(path.join(app.getPath('userData'), 'ha-sync-records.json'))

  csocket.setHaHooks({
    gate: (optCmd, params) => ha.commandGate(optCmd, params),
    sent: (envelope, stage) => ha.onCommandSent(envelope, stage),
    push: (optCmd, result) => {
      if (optCmd === 'HA|info') ha.ingestInfoHa(result)
      else ha.ingestHaRecv(result)
    },
    connection: (state) => ha.onCsocketConnection(state),
    filterActionReport: (result) => ha.filterActionReport(result),
  })

  onProjectFileEvent((event) => ha.onProjectFileEvent(event))

  onCurrentProjectChange((info) =>
    ha.setLocalProject(
      info ? { id: info.id, name: info.name, formatVersion: PROJECT_FORMAT_VERSION } : null,
    ),
  )

  ipcMain.handle(HA_CHANNELS.getSettings, () => ha.getSettings())
  ipcMain.handle(HA_CHANNELS.saveSettings, (_event, settings: unknown) => ha.saveSettings(settings))
  ipcMain.handle(HA_CHANNELS.listLocalIps, () => listLocalIpv4())
  ipcMain.handle(HA_CHANNELS.getState, async () => {
    await ha.getSettings()
    return ha.getState()
  })
  ipcMain.handle(HA_CHANNELS.start, () => ha.start())
  ipcMain.handle(HA_CHANNELS.stop, () => ha.stop())
  ipcMain.handle(HA_CHANNELS.post, (_event, to: string[] | 'all', message: HaAppMessage) =>
    ha.postApp(to, message),
  )
  ipcMain.handle(HA_CHANNELS.setSynced, (_event, projectId: string | null, scope?: HaSyncScope | null) => {
    ha.setSynced(typeof projectId === 'string' && projectId ? projectId : null, scope ?? null)
  })
  ipcMain.handle(HA_CHANNELS.syncModels, (_event, prefer: 'primary' | 'standby') =>
    ha.syncModels(prefer === 'standby' ? 'standby' : 'primary'),
  )
  ipcMain.handle(HA_CHANNELS.writeSynced, (_event, parts: HaSyncedParts) => writeSyncedParts(parts))
  ipcMain.handle(HA_CHANNELS.backup, (_event, params: { document: unknown; label: string; note?: string }) =>
    backupBeforeOverwrite(params),
  )
  ipcMain.handle(HA_CHANNELS.setPeerBusy, (_event, entries: HaBusyEntry[]) => {
    ha.setPeerBusy(Array.isArray(entries) ? entries : [])
  })
  ipcMain.handle(HA_CHANNELS.getSyncRecord, (_event, projectId: string) => records.get(projectId))
  ipcMain.handle(HA_CHANNELS.setSyncRecord, (_event, projectId: string, record: HaSyncRecord | null) =>
    records.set(projectId, record),
  )
}

/** 退出软件等同于 HA|stop：C++ 跟着软件一起退出，这里只清本进程里的计时器 */
export const shutdownHa = (): void => {
  service?.dispose()
}
