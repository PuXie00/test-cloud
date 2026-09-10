import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CreateProjectParams,
  DeleteProjectParams,
  ExportProjectParams,
  HistoryBackupParams,
  HistoryDiffParams,
  HistoryListParams,
  HistoryRestoreParams,
  ImportProjectParams,
  OpenProjectParams,
  SaveAsProjectParams,
  SaveProjectParams,
} from '../../shared/project/types'
import { CONFIG_CHANNELS } from '../../shared/config'
import type { ConfigResult, DeviceConfigCatalog } from '../../shared/config'
import { createCsocketApi } from './csocket-api'
import { createKinematicsApi } from './kinematics-api'
import './loading'

contextBridge.exposeInMainWorld('configAPI', {
  getCatalog: () =>
    ipcRenderer.invoke(CONFIG_CHANNELS.getCatalog) as Promise<ConfigResult<DeviceConfigCatalog>>,
})

contextBridge.exposeInMainWorld('projectAPI', {
  list: () => ipcRenderer.invoke('project:list'),
  create: (params: CreateProjectParams) => ipcRenderer.invoke('project:create', params),
  open: (params: OpenProjectParams) => ipcRenderer.invoke('project:open', params),
  save: (params: SaveProjectParams) => ipcRenderer.invoke('project:save', params),
  saveAs: (params: SaveAsProjectParams) => ipcRenderer.invoke('project:save-as', params),
  delete: (params: DeleteProjectParams) => ipcRenderer.invoke('project:delete', params),
  close: () => ipcRenderer.invoke('project:close'),
  listHistory: (params?: HistoryListParams) =>
    ipcRenderer.invoke('project:history:list', params),
  backupHistory: (params: HistoryBackupParams) =>
    ipcRenderer.invoke('project:history:backup', params),
  restoreHistory: (params: HistoryRestoreParams) =>
    ipcRenderer.invoke('project:history:restore', params),
  diffHistory: (params: HistoryDiffParams) =>
    ipcRenderer.invoke('project:history:diff', params),
  export: (params?: ExportProjectParams) => ipcRenderer.invoke('project:export', params),
  import: (params?: ImportProjectParams) => ipcRenderer.invoke('project:import', params),
  models: {
    list: () => ipcRenderer.invoke('project:models:list'),
    import: (params?: { sourcePath?: string }) =>
      ipcRenderer.invoke('project:models:import', params),
    delete: (params: { modelId: string }) =>
      ipcRenderer.invoke('project:models:delete', params),
    read: (params: { modelId: string }) =>
      ipcRenderer.invoke('project:models:read', params),
  },
})

contextBridge.exposeInMainWorld('toolAPI', {
  confirm: (params: unknown) => ipcRenderer.invoke('tool:confirm', params) as Promise<boolean>,
})

contextBridge.exposeInMainWorld('csocketApi', createCsocketApi())
contextBridge.exposeInMainWorld('kinematicsApi', createKinematicsApi())

// 兼容尚未迁移到域 API 的通道（如更新）；新域请用 xxxAPI 门面
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void) => {
    const subscription = (event: IpcRendererEvent, ...args: unknown[]) => {
      listener(event, ...args)
    }
    ipcRenderer.on(channel, subscription)
    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
  off: (channel: string, ...args: unknown[]) => {
    const listener = args[0] as ((...a: unknown[]) => void) | undefined
    if (listener) {
      ipcRenderer.removeListener(channel, listener as never)
    } else {
      ipcRenderer.removeAllListeners(channel)
    }
  },
})
