import { ipcMain } from 'electron'
import type { ActionDataSaveItem } from '../../../shared/csocket/action-data-save'
import { CSOCKET_CHANNELS } from '../../../shared/csocket/channels'
import type {
  CsocketConfigureContext,
  CsocketSendOpts,
} from '../../../shared/csocket/types'
import type { CsocketApiService } from './api'

let registered = false

type ItemsHandler = (
  items: unknown[],
  opts?: CsocketSendOpts,
) => ReturnType<CsocketApiService['openProject']>

type OptionalItemsHandler = (
  items?: unknown[],
  opts?: CsocketSendOpts,
) => ReturnType<CsocketApiService['openProject']>

const handleItems = (channel: string, fn: ItemsHandler) => {
  ipcMain.handle(channel, async (_e, items: unknown[], opts?: CsocketSendOpts) =>
    fn(items, opts),
  )
}

const handleOptionalItems = (channel: string, fn: OptionalItemsHandler) => {
  ipcMain.handle(
    channel,
    async (_e, items?: unknown[], opts?: CsocketSendOpts) => fn(items, opts),
  )
}

export const registerCppSocketIpc = (api: CsocketApiService): void => {
  if (registered) return
  registered = true

  api.wireClientEvents()

  // 连接 / 心跳 / 重连由 main 自管，不向 UI 暴露 connect/disconnect/getStatus

  ipcMain.handle(
    CSOCKET_CHANNELS.configure,
    async (_e, ctx: CsocketConfigureContext) => api.configure(ctx),
  )

  handleItems(CSOCKET_CHANNELS.openProject, (items, opts) =>
    api.openProject(items as Parameters<CsocketApiService['openProject']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.downloadPlcProject, (items, opts) =>
    api.downloadPlcProject(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.addDevicePlc, (items, opts) =>
    api.addDevicePlc(items as Parameters<CsocketApiService['addDevicePlc']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.deleteDevicePlc, (items, opts) =>
    api.deleteDevicePlc(items as Parameters<CsocketApiService['deleteDevicePlc']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.modifyPlcParam, (items, opts) =>
    api.modifyPlcParam(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.readPlcParamStatus, (items, opts) =>
    api.readPlcParamStatus(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.handleDynamicOperation, (items, opts) =>
    api.handleDynamicOperation(items, opts),
  )

  // Motor
  handleItems(CSOCKET_CHANNELS.configureAxisParamMotor, (items, opts) =>
    api.configureAxisParamMotor(
      items as Parameters<CsocketApiService['configureAxisParamMotor']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.enableMotor, (items, opts) =>
    api.enableMotor(items as Parameters<CsocketApiService['enableMotor']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.resetAlarmMotor, (items, opts) =>
    api.resetAlarmMotor(items as Parameters<CsocketApiService['resetAlarmMotor']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.clear731AlarmMotor, (items, opts) =>
    api.clear731AlarmMotor(items as Parameters<CsocketApiService['clear731AlarmMotor']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.lightSlaveMotor, (items, opts) =>
    api.lightSlaveMotor(items as { lightFlag: number }[], opts),
  )
  handleItems(CSOCKET_CHANNELS.setPositionMotor, (items, opts) =>
    api.setPositionMotor(
      items as Parameters<CsocketApiService['setPositionMotor']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.jogMotor, (items, opts) =>
    api.jogMotor(
      items as Parameters<CsocketApiService['jogMotor']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.moveAbsMotor, (items, opts) =>
    api.moveAbsMotor(
      items as Parameters<CsocketApiService['moveAbsMotor']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.stopMotor, (items, opts) =>
    api.stopMotor(items as Parameters<CsocketApiService['stopMotor']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.eStopMotor, (items, opts) =>
    api.eStopMotor(items as { deceleration: number }[], opts),
  )
  handleItems(CSOCKET_CHANNELS.torqueTestMotor, (items, opts) =>
    api.torqueTestMotor(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.brakeTestMotor, (items, opts) =>
    api.brakeTestMotor(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.commTestMotor, (items, opts) =>
    api.commTestMotor(items as Parameters<CsocketApiService['commTestMotor']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.readAxisStateMotor, (items, opts) =>
    api.readAxisStateMotor(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.readAxisStatusMotor, (items, opts) =>
    api.readAxisStatusMotor(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.configureAxisRunParamMotor, (items, opts) =>
    api.configureAxisRunParamMotor(
      items as Parameters<CsocketApiService['configureAxisRunParamMotor']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.readAxisRunParamMotor, (items, opts) =>
    api.readAxisRunParamMotor(items as Parameters<CsocketApiService['readAxisRunParamMotor']>[0], opts),
  )

  // Model
  handleItems(CSOCKET_CHANNELS.addModelWithDefaultValues, (items, opts) =>
    api.addModelWithDefaultValues(
      items as Parameters<CsocketApiService['addModelWithDefaultValues']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.modifyModelType, (items, opts) =>
    api.modifyModelType(
      items as Parameters<CsocketApiService['modifyModelType']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.scanAllMaster, (items, opts) =>
    api.scanAllMaster(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.coupleModel, (items, opts) =>
    api.coupleModel(items as Parameters<CsocketApiService['coupleModel']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.enableModel, (items, opts) =>
    api.enableModel(items as Parameters<CsocketApiService['enableModel']>[0], opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.resetModel, (items, opts) =>
    api.resetModel(items as Parameters<CsocketApiService['resetModel']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.jogModel, (items, opts) =>
    api.jogModel(items as Parameters<CsocketApiService['jogModel']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.moveTargetModel, (items, opts) =>
    api.moveTargetModel(
      items as Parameters<CsocketApiService['moveTargetModel']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.stopModel, (items, opts) =>
    api.stopModel(items as Parameters<CsocketApiService['stopModel']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.eStopModel, (items, opts) =>
    api.eStopModel(items as Parameters<CsocketApiService['eStopModel']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.configureModelParamModel, (items, opts) =>
    api.configureModelParamModel(
      items as Parameters<CsocketApiService['configureModelParamModel']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.configureRailBindingModel, (items, opts) =>
    api.configureRailBindingModel(
      items as Parameters<CsocketApiService['configureRailBindingModel']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.readModelInfo, (items, opts) =>
    api.readModelInfo(items, opts),
  )

  // PLC
  handleItems(CSOCKET_CHANNELS.simulationSwitchPlc, (items, opts) =>
    api.simulationSwitchPlc(
      items as { deviceId: number; switchFlag: number }[],
      opts,
    ),
  )
  handleOptionalItems(CSOCKET_CHANNELS.allStopPlc, (items, opts) =>
    api.allStopPlc(items as Parameters<CsocketApiService['allStopPlc']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.busResetPlc, (items, opts) =>
    api.busResetPlc(items as Parameters<CsocketApiService['busResetPlc']>[0], opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.resetPlc, (items, opts) =>
    api.resetPlc(items as Parameters<CsocketApiService['resetPlc']>[0], opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.stopActionPlc, (items, opts) =>
    api.stopActionPlc(items as Parameters<CsocketApiService['stopActionPlc']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.ruleStartPlc, (items, opts) =>
    api.ruleStartPlc(items as Parameters<CsocketApiService['ruleStartPlc']>[0], opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.ruleDeletePlc, (items, opts) =>
    api.ruleDeletePlc(items as Parameters<CsocketApiService['ruleDeletePlc']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.syncMotorPlc, (items, opts) =>
    api.syncMotorPlc(
      items as Parameters<CsocketApiService['syncMotorPlc']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.addMotorPlc, (items, opts) =>
    api.syncMotorPlc(
      items as Parameters<CsocketApiService['syncMotorPlc']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.deleteMotorPlc, (items, opts) =>
    api.syncMotorPlc(
      items as Parameters<CsocketApiService['syncMotorPlc']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.addModelPlc, (items, opts) =>
    api.addModelPlc(
      items as Parameters<CsocketApiService['addModelPlc']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.deleteModelPlc, (items, opts) =>
    api.deleteModelPlc(
      items as Parameters<CsocketApiService['deleteModelPlc']>[0],
      opts,
    ),
  )
  handleItems(CSOCKET_CHANNELS.downloadPlcInfoPlc, (items, opts) =>
    api.downloadPlcInfoPlc(
      items as Parameters<CsocketApiService['downloadPlcInfoPlc']>[0],
      opts,
    ),
  )
  handleOptionalItems(CSOCKET_CHANNELS.clearConfigPlc, (items, opts) =>
    api.clearConfigPlc(items, opts),
  )
  handleItems(CSOCKET_CHANNELS.actionReady, (items, opts) =>
    api.actionReady(items as ActionDataSaveItem[], opts),
  )
  handleItems(CSOCKET_CHANNELS.actionGo, (items, opts) =>
    api.actionGo(items as Parameters<CsocketApiService['actionGo']>[0], opts),
  )
  handleItems(CSOCKET_CHANNELS.disconnectMotionConfigPlc, (items, opts) =>
    api.disconnectMotionConfigPlc(items as { motionFlag: number }[], opts),
  )

  // PLC 读取 / 状态查询
  handleOptionalItems(CSOCKET_CHANNELS.projectVerifyPlc, (items, opts) =>
    api.projectVerifyPlc(items, opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.scanMasterPlc, (items, opts) =>
    api.scanMasterPlc(items, opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.readSlaveDevicesPlc, (items, opts) =>
    api.readSlaveDevicesPlc(items, opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.slaveCommErrorPlc, (items, opts) =>
    api.slaveCommErrorPlc(items, opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.readRuleListPlc, (items, opts) =>
    api.readRuleListPlc(items, opts),
  )
  handleOptionalItems(CSOCKET_CHANNELS.autoListReadPlc, (items, opts) =>
    api.autoListReadPlc(items, opts),
  )

  ipcMain.handle(CSOCKET_CHANNELS.getMasterStatusSnapshot, () =>
    api.getMasterStatusSnapshot(),
  )
}
