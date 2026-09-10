import { ipcMain } from 'electron'
import {
  backupHistory,
  diffHistory,
  listHistory,
  restoreHistory,
} from './history'
import {
  deleteModel,
  importModel,
  listModels,
  readModel,
  type DeleteModelParams,
  type ImportModelParams,
  type ReadModelParams,
} from './models'
import { exportProject, importProject } from './pack'
import {
  closeProject,
  createProject,
  deleteProject,
  listProjects,
  openProject,
  saveProject,
  saveProjectAs,
} from './service'
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
} from './types'

let registered = false

export const registerProjectHandlers = (): void => {
  if (registered) return
  registered = true

  ipcMain.handle('project:list', async () => listProjects())

  ipcMain.handle('project:create', async (_event, params: CreateProjectParams) =>
    createProject(params ?? { name: '' }),
  )

  ipcMain.handle('project:open', async (_event, params: OpenProjectParams) =>
    openProject(params),
  )

  ipcMain.handle('project:save', async (_event, params: SaveProjectParams) =>
    saveProject(params),
  )

  ipcMain.handle('project:save-as', async (_event, params: SaveAsProjectParams) =>
    saveProjectAs(params),
  )

  ipcMain.handle('project:delete', async (_event, params: DeleteProjectParams) =>
    deleteProject(params),
  )

  ipcMain.handle('project:close', async () => closeProject())

  ipcMain.handle('project:history:list', async (_event, params?: HistoryListParams) =>
    listHistory(params ?? {}),
  )

  ipcMain.handle('project:history:backup', async (_event, params: HistoryBackupParams) =>
    backupHistory(params),
  )

  ipcMain.handle('project:history:restore', async (_event, params: HistoryRestoreParams) =>
    restoreHistory(params),
  )

  ipcMain.handle('project:history:diff', async (_event, params: HistoryDiffParams) =>
    diffHistory(params),
  )

  ipcMain.handle('project:export', async (_event, params?: ExportProjectParams) =>
    exportProject(params ?? {}),
  )

  ipcMain.handle('project:import', async (_event, params?: ImportProjectParams) =>
    importProject(params ?? {}),
  )

  ipcMain.handle('project:models:list', async () => listModels())

  ipcMain.handle(
    'project:models:import',
    async (_event, params?: ImportModelParams) => importModel(params ?? {}),
  )

  ipcMain.handle(
    'project:models:delete',
    async (_event, params: DeleteModelParams) => deleteModel(params),
  )

  ipcMain.handle(
    'project:models:read',
    async (_event, params: ReadModelParams) => readModel(params),
  )
}
