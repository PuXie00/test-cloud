import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HaAppMessage } from '../../shared/ha/protocol'
import {
  HA_CHANNELS,
  type HaLocalIp,
  type HaResult,
  type HaSettings,
  type HaState,
  type HaSyncRecord,
  type HaSyncScope,
} from '../../shared/ha/types'

/** 备机写盘时同步范围内的部分（electron/main/ha/project-io.ts） */
export type HaSyncedPartsInput = {
  projectId: string
  setup: unknown
  motion?: unknown
  rules?: unknown
  meta?: unknown
  view?: unknown
}

/** 主备热备：设置、开启 / 关闭、状态推送 */
export const createHaApi = () => ({
  getSettings: () => ipcRenderer.invoke(HA_CHANNELS.getSettings) as Promise<HaSettings>,
  saveSettings: (settings: HaSettings) =>
    ipcRenderer.invoke(HA_CHANNELS.saveSettings, settings) as Promise<HaResult<HaSettings>>,
  listLocalIps: () => ipcRenderer.invoke(HA_CHANNELS.listLocalIps) as Promise<HaLocalIp[]>,
  getState: () => ipcRenderer.invoke(HA_CHANNELS.getState) as Promise<HaState>,
  start: () => ipcRenderer.invoke(HA_CHANNELS.start) as Promise<HaResult<HaState>>,
  stop: () => ipcRenderer.invoke(HA_CHANNELS.stop) as Promise<HaResult<HaState>>,
  onState: (listener: (state: HaState) => void) => {
    const subscription = (_event: IpcRendererEvent, state: HaState) => listener(state)
    ipcRenderer.on(HA_CHANNELS.state, subscription)
    return () => {
      ipcRenderer.removeListener(HA_CHANNELS.state, subscription)
    }
  },
  /** 工程同步：发给另一台（'all' 为所有能同步的） */
  post: (to: string[] | 'all', message: HaAppMessage) =>
    ipcRenderer.invoke(HA_CHANNELS.post, to, message) as Promise<boolean>,
  onMessage: (listener: (event: { from: string; message: HaAppMessage }) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: { from: string; message: HaAppMessage }) =>
      listener(payload)
    ipcRenderer.on(HA_CHANNELS.message, subscription)
    return () => {
      ipcRenderer.removeListener(HA_CHANNELS.message, subscription)
    }
  },
  setSynced: (projectId: string | null, scope?: HaSyncScope | null) =>
    ipcRenderer.invoke(HA_CHANNELS.setSynced, projectId, scope ?? null) as Promise<void>,
  syncModels: (prefer: 'primary' | 'standby') =>
    ipcRenderer.invoke(HA_CHANNELS.syncModels, prefer) as Promise<void>,
  onModelsChanged: (listener: () => void) => {
    const subscription = () => listener()
    ipcRenderer.on(HA_CHANNELS.modelsChanged, subscription)
    return () => {
      ipcRenderer.removeListener(HA_CHANNELS.modelsChanged, subscription)
    }
  },
  writeSynced: (parts: HaSyncedPartsInput) =>
    ipcRenderer.invoke(HA_CHANNELS.writeSynced, parts) as Promise<HaResult<null>>,
  backup: (params: { document: unknown; label: string; note?: string }) =>
    ipcRenderer.invoke(HA_CHANNELS.backup, params) as Promise<HaResult<null>>,
  /** 另一台在用的设备：id 是物体或电机（全局互斥），label 如「物体 6」，by 是对方名称 */
  setPeerBusy: (entries: { id: number; label: string; by: string }[]) =>
    ipcRenderer.invoke(HA_CHANNELS.setPeerBusy, entries) as Promise<void>,
  onBlocked: (listener: (event: { optCmd: string; reason: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, payload: { optCmd: string; reason: string }) =>
      listener(payload)
    ipcRenderer.on(HA_CHANNELS.blocked, subscription)
    return () => {
      ipcRenderer.removeListener(HA_CHANNELS.blocked, subscription)
    }
  },
  getSyncRecord: (projectId: string) =>
    ipcRenderer.invoke(HA_CHANNELS.getSyncRecord, projectId) as Promise<HaSyncRecord | null>,
  setSyncRecord: (projectId: string, record: HaSyncRecord | null) =>
    ipcRenderer.invoke(HA_CHANNELS.setSyncRecord, projectId, record) as Promise<void>,
})

export type HaAPI = ReturnType<typeof createHaApi>
