import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ActionDataSaveItem } from '../../shared/csocket/action-data-save'
import { CSOCKET_CHANNELS } from '../../shared/csocket/channels'
import type {
  CsocketConfigureContext,
  CsocketMessageEvent,
  CsocketResult,
  CppAckResult,
  CsocketSendOpts,
} from '../../shared/csocket/types'

type SendResult = Promise<CsocketResult<CppAckResult>>
type MsgHandler = (msg: CppAckResult) => void
type SendFn = (items: unknown[], opts?: CsocketSendOpts) => SendResult
type OptionalSendFn = (items?: unknown[], opts?: CsocketSendOpts) => SendResult
type ActionDataSaveFn = (items: ActionDataSaveItem[], opts?: CsocketSendOpts) => SendResult

const onChannel = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invokeSend =
  (channel: string): SendFn =>
  (items, opts) =>
    ipcRenderer.invoke(channel, items, opts) as SendResult

const invokeOptionalSend =
  (channel: string): OptionalSendFn =>
  (items, opts) =>
    ipcRenderer.invoke(channel, items, opts) as SendResult

/** preload 仅转发业务 IPC；WebSocket 连接生命周期由 main 管理 */
export const createCsocketApi = () => ({
  configure: (ctx: CsocketConfigureContext) =>
    ipcRenderer.invoke(CSOCKET_CHANNELS.configure, ctx) as Promise<CsocketResult<null>>,
  openProject: invokeSend(CSOCKET_CHANNELS.openProject),
  downloadPlcProject: invokeSend(CSOCKET_CHANNELS.downloadPlcProject),
  addDevicePlc: invokeSend(CSOCKET_CHANNELS.addDevicePlc),
  deleteDevicePlc: invokeSend(CSOCKET_CHANNELS.deleteDevicePlc),
  modifyPlcParam: invokeSend(CSOCKET_CHANNELS.modifyPlcParam),
  readPlcParamStatus: invokeSend(CSOCKET_CHANNELS.readPlcParamStatus),
  handleDynamicOperation: invokeSend(CSOCKET_CHANNELS.handleDynamicOperation),

  // Motor
  configureAxisParamMotor: invokeSend(CSOCKET_CHANNELS.configureAxisParamMotor),
  enableMotor: invokeSend(CSOCKET_CHANNELS.enableMotor),
  resetAlarmMotor: invokeSend(CSOCKET_CHANNELS.resetAlarmMotor),
  clear731AlarmMotor: invokeSend(CSOCKET_CHANNELS.clear731AlarmMotor),
  lightSlaveMotor: invokeSend(CSOCKET_CHANNELS.lightSlaveMotor),
  setPositionMotor: invokeSend(CSOCKET_CHANNELS.setPositionMotor),
  jogMotor: invokeSend(CSOCKET_CHANNELS.jogMotor),
  moveAbsMotor: invokeSend(CSOCKET_CHANNELS.moveAbsMotor),
  stopMotor: invokeSend(CSOCKET_CHANNELS.stopMotor),
  eStopMotor: invokeSend(CSOCKET_CHANNELS.eStopMotor),
  torqueTestMotor: invokeSend(CSOCKET_CHANNELS.torqueTestMotor),
  brakeTestMotor: invokeSend(CSOCKET_CHANNELS.brakeTestMotor),
  commTestMotor: invokeSend(CSOCKET_CHANNELS.commTestMotor),
  readAxisStateMotor: invokeSend(CSOCKET_CHANNELS.readAxisStateMotor),
  readAxisStatusMotor: invokeSend(CSOCKET_CHANNELS.readAxisStatusMotor),
  configureAxisRunParamMotor: invokeSend(CSOCKET_CHANNELS.configureAxisRunParamMotor),
  readAxisRunParamMotor: invokeSend(CSOCKET_CHANNELS.readAxisRunParamMotor),

  // Model
  addModelWithDefaultValues: invokeSend(CSOCKET_CHANNELS.addModelWithDefaultValues),
  modifyModelType: invokeSend(CSOCKET_CHANNELS.modifyModelType),
  scanAllMaster: invokeOptionalSend(CSOCKET_CHANNELS.scanAllMaster),
  coupleModel: invokeSend(CSOCKET_CHANNELS.coupleModel),
  enableModel: invokeSend(CSOCKET_CHANNELS.enableModel),
  resetModel: invokeOptionalSend(CSOCKET_CHANNELS.resetModel),
  jogModel: invokeSend(CSOCKET_CHANNELS.jogModel),
  moveTargetModel: invokeSend(CSOCKET_CHANNELS.moveTargetModel),
  stopModel: invokeSend(CSOCKET_CHANNELS.stopModel),
  eStopModel: invokeSend(CSOCKET_CHANNELS.eStopModel),
  configureModelParamModel: invokeSend(CSOCKET_CHANNELS.configureModelParamModel),
  configureRailBindingModel: invokeSend(CSOCKET_CHANNELS.configureRailBindingModel),
  readModelInfo: invokeSend(CSOCKET_CHANNELS.readModelInfo),

  // PLC
  simulationSwitchPlc: invokeSend(CSOCKET_CHANNELS.simulationSwitchPlc),
  allStopPlc: invokeOptionalSend(CSOCKET_CHANNELS.allStopPlc),
  busResetPlc: invokeSend(CSOCKET_CHANNELS.busResetPlc),
  resetPlc: invokeOptionalSend(CSOCKET_CHANNELS.resetPlc),
  actionStop: invokeOptionalSend(CSOCKET_CHANNELS.actionStop),
  ruleStartPlc: invokeSend(CSOCKET_CHANNELS.ruleStartPlc),
  ruleDeletePlc: invokeOptionalSend(CSOCKET_CHANNELS.ruleDeletePlc),
  addMotorPlc: invokeSend(CSOCKET_CHANNELS.addMotorPlc),
  syncMotorPlc: invokeSend(CSOCKET_CHANNELS.syncMotorPlc),
  deleteMotorPlc: invokeSend(CSOCKET_CHANNELS.deleteMotorPlc),
  addModelPlc: invokeSend(CSOCKET_CHANNELS.addModelPlc),
  deleteModelPlc: invokeSend(CSOCKET_CHANNELS.deleteModelPlc),
  downloadPlcInfoPlc: invokeSend(CSOCKET_CHANNELS.downloadPlcInfoPlc),
  clearConfigPlc: invokeOptionalSend(CSOCKET_CHANNELS.clearConfigPlc),
  actionReady: invokeSend(CSOCKET_CHANNELS.actionReady) as ActionDataSaveFn,
  actionGo: invokeSend(CSOCKET_CHANNELS.actionGo),
  disconnectMotionConfigPlc: invokeSend(CSOCKET_CHANNELS.disconnectMotionConfigPlc),

  // PLC 读取 / 状态查询
  projectVerifyPlc: invokeOptionalSend(CSOCKET_CHANNELS.projectVerifyPlc),
  scanMasterPlc: invokeOptionalSend(CSOCKET_CHANNELS.scanMasterPlc),
  readSlaveDevicesPlc: invokeOptionalSend(CSOCKET_CHANNELS.readSlaveDevicesPlc),
  slaveCommErrorPlc: invokeOptionalSend(CSOCKET_CHANNELS.slaveCommErrorPlc),
  readRuleListPlc: invokeOptionalSend(CSOCKET_CHANNELS.readRuleListPlc),
  autoListReadPlc: invokeOptionalSend(CSOCKET_CHANNELS.autoListReadPlc),


  getMasterStatusSnapshot: () =>
    ipcRenderer.invoke(CSOCKET_CHANNELS.getMasterStatusSnapshot) as Promise<CppAckResult>,

  onReadMasterStatusPolling: (cb: MsgHandler) => onChannel(CSOCKET_CHANNELS.readMasterStatusPolling, cb),
  onReadModelInfoPolling: (cb: MsgHandler) => onChannel(CSOCKET_CHANNELS.readModelInfoPolling, cb),
  onReadAxisInfoPolling: (cb: MsgHandler) => onChannel(CSOCKET_CHANNELS.readAxisInfoPolling, cb),
  onVerifyProject: (cb: MsgHandler) => onChannel(CSOCKET_CHANNELS.verifyProject, cb),
  onClockSync: (cb: MsgHandler) => onChannel(CSOCKET_CHANNELS.clockSync, cb),
})

export type CsocketApi = ReturnType<typeof createCsocketApi>
