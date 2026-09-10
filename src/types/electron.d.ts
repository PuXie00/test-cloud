/**
 * 渲染进程 Window API
 * 数据契约见 shared/project/types
 */
import type {
  CreateProjectParams,
  DeleteProjectParams,
  DiffEntry,
  ExportProjectParams,
  HistoryBackupParams,
  HistoryDiffParams,
  HistoryEntry,
  HistoryListParams,
  HistoryRestoreParams,
  ImportProjectParams,
  OpenProjectParams,
  ProjectDocumentLike,
  ProjectResult,
  ProjectSummary,
  SaveAsProjectParams,
  SaveProjectParams,
} from '../../shared/project/types'
import type { ActionDataSaveItem } from '../../shared/csocket/action-data-save'
import type {
  CsocketConfigureContext,
  CsocketMessageEvent,
  CppAckResult,
  CsocketSendOpts,
} from '../../shared/csocket/types'
export type { CppAckResult };
import type { ConfigResult, DeviceConfigCatalog } from '../../shared/config'
import type { KinematicsSolveResult } from '../../shared/kinematics/types'

export type {
  CreateProjectParams,
  DeleteProjectParams,
  DiffEntry,
  ExportProjectParams,
  HistoryBackupParams,
  HistoryDiffParams,
  HistoryEntry,
  HistoryListParams,
  HistoryRestoreParams,
  ImportProjectParams,
  OpenProjectParams,
  ProjectDocumentLike,
  ProjectResult,
  ProjectSummary,
  SaveAsProjectParams,
  SaveProjectParams,
} from '../../shared/project/types'

export type ProjectModelEntry = {
  modelId: string
  fileName: string
  ext: string // glb | obj
  sizeBytes: number
}

/** 工程域门面：window.projectAPI */
export type ProjectAPI = {
  list: () => Promise<ProjectResult<ProjectSummary[]>>
  create: (params: CreateProjectParams) => Promise<ProjectResult<ProjectSummary>>
  open: (
    params: OpenProjectParams,
  ) => Promise<ProjectResult<{ summary: ProjectSummary; document: ProjectDocumentLike }>>
  save: (params: SaveProjectParams) => Promise<ProjectResult<ProjectSummary>>
  saveAs: (params: SaveAsProjectParams) => Promise<ProjectResult<ProjectSummary>>
  delete: (params: DeleteProjectParams) => Promise<ProjectResult<null>>
  close: () => Promise<ProjectResult<null>>
  listHistory: (params?: HistoryListParams) => Promise<ProjectResult<HistoryEntry[]>>
  backupHistory: (params: HistoryBackupParams) => Promise<ProjectResult<HistoryEntry>>
  restoreHistory: (
    params: HistoryRestoreParams,
  ) => Promise<ProjectResult<ProjectDocumentLike>>
  diffHistory: (params: HistoryDiffParams) => Promise<ProjectResult<DiffEntry[]>>
  export: (params?: ExportProjectParams) => Promise<ProjectResult<{ filePath: string }>>
  import: (params?: ImportProjectParams) => Promise<ProjectResult<ProjectSummary>>
  models: {
    list: () => Promise<ProjectResult<ProjectModelEntry[]>>
    import: (params?: {
      sourcePath?: string
    }) => Promise<ProjectResult<ProjectModelEntry>>
    delete: (params: { modelId: string }) => Promise<ProjectResult<null>>
    read: (params: {
      modelId: string
    }) => Promise<ProjectResult<{ data: ArrayBuffer; fileName: string; ext: string }>>
  }
}

type CsocketSendResult = Promise<CppAckResult>
type CsocketSendFn = (items: unknown[], opts?: CsocketSendOpts) => CsocketSendResult

/** C++ Socket 域门面：window.csocketApi（连接由 main 常驻维护） */
export type CsocketAPI = {
  configure: (ctx: CsocketConfigureContext) => Promise<void>
  openProject: CsocketSendFn
  downloadPlcProject: CsocketSendFn
  addDevicePlc: CsocketSendFn
  deleteDevicePlc: CsocketSendFn
  modifyPlcParam: CsocketSendFn
  readPlcParamStatus: CsocketSendFn
  handleDynamicOperation: CsocketSendFn

  // Motor
  configureAxisParamMotor: CsocketSendFn
  enableMotor: CsocketSendFn
  resetAlarmMotor: CsocketSendFn
  clear731AlarmMotor: CsocketSendFn
  lightSlaveMotor: CsocketSendFn
  setPositionMotor: CsocketSendFn
  jogMotor: CsocketSendFn
  moveAbsMotor: CsocketSendFn
  stopMotor: CsocketSendFn
  eStopMotor: CsocketSendFn
  torqueTestMotor: CsocketSendFn
  brakeTestMotor: CsocketSendFn
  commTestMotor: CsocketSendFn
  readAxisStateMotor: CsocketSendFn
  readAxisStatusMotor: CsocketSendFn
  configureAxisRunParamMotor: CsocketSendFn
  readAxisRunParamMotor: CsocketSendFn

  // Model
  addModelWithDefaultValues: CsocketSendFn
  modifyModelType: CsocketSendFn
  scanAllMaster: CsocketSendFn
  coupleModel: CsocketSendFn
  enableModel: CsocketSendFn
  resetModel: CsocketSendFn
  jogModel: CsocketSendFn
  moveTargetModel: CsocketSendFn
  syncMoveTargetModel: CsocketSendFn
  stopModel: CsocketSendFn
  eStopModel: CsocketSendFn
  configureModelParamModel: CsocketSendFn
  configureRailBindingModel: CsocketSendFn
  readModelInfo: CsocketSendFn

  // PLC
  simulationSwitchPlc: CsocketSendFn
  allStopPlc: CsocketSendFn
  busResetPlc: CsocketSendFn
  resetPlc: CsocketSendFn
  actionPreparePlc: CsocketSendFn
  actionSyncCallPlc: CsocketSendFn
  stopActionPlc: CsocketSendFn
  ruleStartPlc: CsocketSendFn
  ruleDeletePlc: CsocketSendFn
  addMotorPlc: CsocketSendFn
  syncMotorPlc: CsocketSendFn
  deleteMotorPlc: CsocketSendFn
  addModelPlc: CsocketSendFn
  deleteModelPlc: CsocketSendFn
  downloadPlcInfoPlc: CsocketSendFn
  clearConfigPlc: CsocketSendFn
  actionDataSavePlc: (items: ActionDataSaveItem[], opts?: CsocketSendOpts) => CsocketSendResult
  disconnectMotionConfigPlc: CsocketSendFn

  // PLC 读取 / 状态查询
  projectVerifyPlc: CsocketSendFn
  scanMasterPlc: CsocketSendFn
  readSlaveDevicesPlc: CsocketSendFn
  slaveCommErrorPlc: CsocketSendFn
  readRuleListPlc: CsocketSendFn
  autoListReadPlc: CsocketSendFn

  getMasterStatusSnapshot: () => Promise<CppAckResult>

  onReadMasterStatusPolling: (cb: (msg: CppAckResult) => void) => () => void
  onReadModelInfoPolling: (cb: (msg: CppAckResult) => void) => () => void
  onReadAxisInfoPolling: (cb: (msg: CppAckResult) => void) => () => void
  onVerifyProject: (cb: (msg: CppAckResult) => void) => () => void
  onClockSync: (cb: (msg: CppAckResult) => void) => () => void
}

type ConfigAPI = {
  getCatalog: () => Promise<ConfigResult<DeviceConfigCatalog>>
}

export type KinematicsAPI = {
  solve: (items: unknown[]) => Promise<KinematicsSolveResult>
}

export type ConfirmToolParams = {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作：使用 warning 图标 */
  danger?: boolean
}

/** 工具域门面：window.toolAPI */
export type ToolAPI = {
  confirm: (params: ConfirmToolParams) => Promise<boolean>
}

declare global {
  interface Window {
    projectAPI: ProjectAPI
    csocketApi: CsocketAPI
    kinematicsApi: KinematicsAPI
    configAPI: ConfigAPI
    toolAPI: ToolAPI
    /** @deprecated 新域请用 xxxAPI；仅兼容尚未迁移的通道 */
    ipcRenderer: {
      on: (
        channel: string,
        listener: (event: unknown, ...args: unknown[]) => void,
      ) => (() => void) | void
      off: (channel: string, ...args: unknown[]) => void
      send: (channel: string, ...args: unknown[]) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
  }
}

export {}
