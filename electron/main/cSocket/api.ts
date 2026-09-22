import type { ActionDataSaveItem } from '../../../shared/csocket/action-data-save'
import type {
  CsocketConfigureContext,
  CsocketConnectionState,
  CsocketMessageEvent,
  CsocketParseErrorEvent,
  CsocketResult,
  CppAckResult,
  CsocketSendOpts,
  CppEnvelope,
} from '../../../shared/csocket/types'
import { isCppAckOk } from '../../../shared/csocket/ack'
import {
  PlcMasterStatusStore,
  shouldClearPlcMasterStatus,
  type PlcMasterStatus,
} from '../../../shared/csocket/plc-master-status'
import { AxisInfoStore } from '../../../shared/csocket/axis-info'
import { ModelInfoStore } from '../../../shared/csocket/model-info'
import type { CppSocketClient } from './client'
import { BrowserWindow, ipcMain } from 'electron'
import { CSOCKET_CHANNELS } from '../../../shared/csocket/channels'

type SendData = CppAckResult

const toNullResult = (r: CsocketResult<void>): CsocketResult<null> =>
  r.ok ? { ok: true, data: null } : r

const ackFailed = (r: SendData): SendData => ({
  success: false,
  code: String(r.code ?? 'ACK_FAILED'),
  message: r.message ?? 'C++ ACK reported failure',
  data: r.data,
})

/** C++ CONFIG|Pro|open 只认 .\Project\<工程名>，不发本机绝对路径 */
const toCppRelativeProjectPath = (projectPath: string): string => {
  const normalized = projectPath.trim().replace(/\//g, '\\').replace(/\\+$/, '')
  const match = normalized.match(/(?:^|\\)Project\\([^\\]+)$/i)
  if (match?.[1]) return `.\\Project\\${match[1]}`
  const name = normalized.split('\\').filter(Boolean).pop() ?? ''
  return `.\\Project\\${name}`
}

type ModelParamCount = {
  modelType: number
  modelRunDirection: number
  pulleyDistance: number
  safetyRadius?: number
  initialTiltDirection?: number
  hangingPointCount: number
  hangingPointArray: number[][]
  axisIdList: number[]
  hMaxStroke: number
  hMinStroke: number
  hDefaultVelocity: number
  hDefaultAcceleration: number
  hDefaultDeceleration: number
  hMaxAcceleration: number
  hMaxDeceleration: number
  hAbnormalDeceleration: number
  pMaxStroke?: number
  pMinStroke?: number
  pDefaultVelocity?: number
  pDefaultAcceleration?: number
  pDefaultDeceleration?: number
  pMaxAcceleration?: number
  pMaxDeceleration?: number
  pAbnormalDeceleration?: number
  pDefaultMaxVelocity?: number
  yMaxStroke?: number
  yMinStroke?: number
  yDefaultVelocity?: number
  yDefaultAcceleration?: number
  yDefaultDeceleration?: number
  yMaxAcceleration?: number
  yMaxDeceleration?: number
  yAbnormalDeceleration?: number
  yDefaultMaxVelocity?: number
}

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

const EMPTY_POLLING_ACK: CppAckResult = { success: true, data: [] }

export class CsocketApiService {
  private ctx: CsocketConfigureContext = {}
  private wired = false
  private readonly plcMasterStatus = new PlcMasterStatusStore()
  private readonly broadcast: (channel: string, payload: unknown) => void = broadcast
  private readonly modelInfo = new ModelInfoStore(() => {
    this.broadcast(CSOCKET_CHANNELS.readModelInfoPolling, EMPTY_POLLING_ACK)
  })
  private readonly axisInfo = new AxisInfoStore(() => {
    this.broadcast(CSOCKET_CHANNELS.readAxisInfoPolling, EMPTY_POLLING_ACK)
  })


  constructor(
    private readonly client: CppSocketClient,
  ) {}

  private broadcastMasterStatus(data: PlcMasterStatus[]): void {
    console.log('broadcastMasterStatus', JSON.stringify(data));
    this.broadcast(CSOCKET_CHANNELS.readMasterStatusPolling, {
      success: true,
      data,
    })
  }

  private clearPlcMasterStatus(): void {
    this.plcMasterStatus.clear()
    this.broadcastMasterStatus([])
  }

  private clearAxisModelInfo(): void {
    this.modelInfo.clear()
    this.axisInfo.clear()
  }

  getMasterStatusSnapshot(): CppAckResult {
    return { success: true, data: this.plcMasterStatus.snapshot() }
  }

  /** 订阅 client 下行并按语义通道广播（只调用一次） */
  wireClientEvents(): void {
    if (this.wired) return
    this.wired = true

    this.client.onMessage((payload) => {
      if (!payload || typeof payload !== 'object') return
      if (
        'type' in payload &&
        (payload as CsocketParseErrorEvent).type === 'parseError'
      ) {
        return
      }
      const envelope = payload as CppEnvelope
      const msg = envelope.result
      const optCmd = envelope.OptCmd
      if (!optCmd) return
      if (optCmd === 'Info|plc') {
        // console.log('Info|plc', JSON.stringify(msg));
        const next = this.plcMasterStatus.ingestPlc(msg)
        if (next) this.broadcastMasterStatus(next)
      }
      if (optCmd === 'INfO|tcpConn') {
        console.log('INFO|tcpConn', JSON.stringify(msg));
        const next = this.plcMasterStatus.ingestTcpConn(msg)
        if (next) this.broadcastMasterStatus(next)
      }
      if (optCmd === 'Info|model') {
        if (this.modelInfo.ingest(msg)) {
          this.broadcast(CSOCKET_CHANNELS.readModelInfoPolling, msg)
        }
      }
      if (optCmd === 'Info|axis') {
        if (this.axisInfo.ingest(msg)) {
          this.broadcast(CSOCKET_CHANNELS.readAxisInfoPolling, msg)
        }
      }
      if (optCmd === 'CONFIG|Pro|verify') {
        this.broadcast(CSOCKET_CHANNELS.verifyProject, msg as CppAckResult<{
          deviceId: number, // plc id
          version: number, // plc version
          proVerify: number, // 工程验证结果 0： 成功 1： 失败
        }>)
        console.log('CONFIG|Pro|verify', JSON.stringify(msg));
      }
      if (optCmd === 'Info|clockSync') {
        this.broadcast(CSOCKET_CHANNELS.clockSync, msg as CppAckResult<{
          timestamp: number,
        }>)
      }
    })

    this.client.onStatus((status) => {
      if (shouldClearPlcMasterStatus(status.state)) {
        this.clearPlcMasterStatus()
        this.clearAxisModelInfo()
      }
    })
  }

  configure(next: CsocketConfigureContext): CsocketResult<null> {
    this.ctx = { ...this.ctx, ...next }
    return { ok: true, data: null }
  }
  // 连接websocket
  connect(url: string): Promise<CsocketResult<null>> {
    return this.client.connect(url).then(toNullResult)
  }
  // 断开websocket
  disconnect(): Promise<CsocketResult<null>> {
    return this.client.disconnect().then(toNullResult)
  }

  // 获取websocket状态
  getStatus(): CsocketConnectionState {
    return this.client.getStatus()
  }

  // 发送消息
  private sendBuilt(
    id: string,
    addr: string,
    params: unknown[],
    opts?: CsocketSendOpts,
  ): Promise<SendData> {
    const projectIdEnabled = opts?.projectId ?? true
    const userEnabled = opts?.user ?? true
    const paramHeard =
      opts?.paramHeard && opts.paramHeard.length > 0 ? opts.paramHeard : undefined
    console.log('sendBuilt', id, JSON.stringify(params),)
    return new Promise<SendData>((resolve) => {
      this.client.send(
        {
          OptCmd: id,
          addr,
          params,
          ...(paramHeard ? { paramHeard } : {}),
          projectId: projectIdEnabled ? this.ctx.projectId : undefined,
          user: userEnabled ? this.ctx.user : undefined,
        },
        opts,
      ).then((result) => {
        console.log('sendBuilt result', JSON.stringify(result))
        if(result.ok && result.data) {
          resolve(result.data)
        } else {
          resolve({ success: false,code: 'SEND_FAILED',message: 'SEND_FAILED' })
        }
      }).catch((err) => {
        console.error('sendBuilt error', err)
        resolve({ success: false,code: 'SEND_FAILED',message: 'SEND_FAILED' })
      })
    })
  }

  /*
  * 额外，设备描述外的功能
  */
  // 打开项目：C++ 只收相对工程目录，如 .\Project\hi
  openProject(items: {
    projectPath: string
  }[], opts?: CsocketSendOpts) {
    this.clearPlcMasterStatus()
    this.clearAxisModelInfo()
    const mapped = items.map((item) => ({
      projectPath: toCppRelativeProjectPath(item.projectPath),
    }))
    return this.sendBuilt('CONFIG|Pro|open', '', mapped, { timeoutMs: 10000, ...opts })
  }
  // 手动添加plc
  addDevicePlc(items: {
    deviceId: number,
    ip: string,
    port: number
  }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('CONFIG|DEV|addPlc', '', items, opts)
  }
  // 手动删除plc
  deleteDevicePlc(items: {
    deviceId: number
  }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('CONFIG|DEV|deletePlc', '', items, opts)
  }
  // 修改Plc参数ip
  modifyPlcParam(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('modifyPlcParam', '', items, opts)
  }
  // 读取plc参数状态
  readPlcParamStatus(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('readPlcParamStatus', '', items, opts)
  }
  // 处理动态操作
  handleDynamicOperation(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('handleDynamicOperation', '', items, opts)
  }
  // 封装新增默认带默认值
  async addModelWithDefaultValues(
    items: {
      deviceId: number
      deviceType: number
      paramCount: ModelParamCount
    }[],
    opts?: CsocketSendOpts,
  ): Promise<SendData> {
    const addModelResult = await this.addModelPlc(
      items.map(({ deviceId, deviceType }) => ({ deviceId, deviceType })),
      opts,
    )
    if (!isCppAckOk(addModelResult)) return ackFailed(addModelResult)

    const configureResult = await this.configureModelParamModel(
      items.map(({ deviceId, paramCount }) => ({ deviceId, paramCount })),
      opts,
    )
    return isCppAckOk(configureResult)
      ? configureResult
      : ackFailed(configureResult)
  }
  // 封装修改物体类型：删旧 → 增新 → 配参（失败不回滚）
  async modifyModelType(items: {
    deviceId: number,
    oldDeviceType: number,
    deviceType: number
    paramCount: ModelParamCount
  }[], opts?: CsocketSendOpts): Promise<SendData>{
    console.log('modifyModelType', items)
    const deleteModelResult = await this.deleteModelPlc(
      items.map(({ deviceId, oldDeviceType }) => ({ deviceId, deviceType: oldDeviceType })),
      opts,
    )
    if (!isCppAckOk(deleteModelResult)) return ackFailed(deleteModelResult)
    const addModelResult = await this.addModelPlc(
      items.map(({ deviceId, deviceType }) => ({ deviceId, deviceType })),
      opts,
    )
    if (!isCppAckOk(addModelResult)) return ackFailed(addModelResult)

    const configureResult = await this.configureModelParamModel(
      items.map(({ deviceId, paramCount }) => ({ deviceId, paramCount })),
      opts,
    )
    return isCppAckOk(configureResult)
      ? configureResult
      : ackFailed(configureResult)
  }
  // 扫描全部主控
  async scanAllMaster(items?: unknown[], opts?: CsocketSendOpts) {
    const result = await this.sendBuilt('Info|scan', '0x104E', items ?? [], opts)
    if (result.data) {
      const data = result.data?.map((item: any) => {
        return {
          ip: item.ip as string,
          plcModel: item.plcModel as number,
          axis: [...item.axisC.map((axis: any,index: number) => ({ busNo: 0, slaveNo: index, gourdNo: axis.gourdNo })), ...item.axisD.map((axis: any,index: number) => ({ busNo: 1, slaveNo: index + item.axisC.length, gourdNo: axis.gourdNo }))],
        }
      })
      result.data = data
      result.success = true
      return result
    }
    return {success: false,code: 'SCAN_FAILED',message: 'SCAN_FAILED'}
    // return {success: false,data:[{ ip: '192.168.1.30', plcModel: 4, axis: [{ busNo: 0, slaveNo: 0, gourdNo: 253 },{ busNo: 0, slaveNo: 1, gourdNo: 253 },{ busNo: 1, slaveNo: 2, gourdNo: 253 },{ busNo: 1, slaveNo: 3, gourdNo: 253 }] }]}
  }
  // plc下载工程
  downloadPlcProject(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('CONFIG|Pro|download', '', items, opts)
  }

  // 动作准备Ready

  actionReady(items: ActionDataSaveItem[], opts?: CsocketSendOpts) {
    // 
    const isTMaped = [];
    const isNotTMaped: {
      actionId: number,
      modelList: unknown[],
      IOBlockList: unknown[]
    }[] = [];
    items.forEach(item => {
      if(item.trajectoryMode) {
        isTMaped.push(item)
      } else {
        isNotTMaped.push({
          actionId: item.actionId,
          modelList: item.modelList,
          IOBlockList: item.IOBlockList,
        })
      }
    })
    console.log('isNotTMaped', JSON.stringify(isNotTMaped))
    this.syncMovePrepare(isNotTMaped, opts)
  }
  // 动作执行 Go
  actionGo(items: {
    actionId: number,
    runDirection: number,
    speedScale: number,
    loopCount: number,
  }[], opts?: CsocketSendOpts) {
    const maped = items.map((item) => ({
      actionId: item.actionId,
      startFlag: 1,
    }))
    return this.syncMovebegin(maped, opts)
  }

  // 动作停止 Stop
  actionStop(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Action|stop', '', items, opts)
  }

  /*
  * 电机
  */
  // 配置轴参数
  configureAxisParamMotor(items: {
    paramCount: {
      deviceId: number,// 电机id
      axisDirection: number,// 电机方向
      workingStroke: number,// 工作行程
      reductionRatio: number,// 减速比
      positionError: number,// 位置误差
      maxAxisVelocity: number,// 最大速度
      weightLow: number,// 称重下限
      weightHigh: number,// 称重上限
      loadLow: number,// 力矩下限
      loadHigh: number,// 力矩上限
    }
  }[], opts?: CsocketSendOpts) {
    const mapped = items.map((item) => ({
      paramCount: Object.keys(item.paramCount).length,
      ...item.paramCount,
    }))
    return this.sendBuilt('Config|axisParam', '0x0020', mapped, opts)
  }
  // 轴使能/断使能
  enableMotor(items: { 
    deviceId: number //电机id
    enableFlag: number //使能标志
  }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|enable', '0x0001', items, opts)
  }
  // 报警复位
  resetAlarmMotor(items: {
    deviceId: number //电机id
  }[
    
  ], opts?: CsocketSendOpts) {

    return this.sendBuilt('Operation|resetAlarm', '0x0002', items, opts)
  }
  // 清除731报警
  clear731AlarmMotor(items: 
    {
      deviceId: number //电机id
    }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|clear731Alarm', '0x0004', items, opts)
  }
  // 点亮从站灯带
  lightSlaveMotor(items: { lightFlag: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|lightSlave', '0x0005', items, opts)
  }
  // 轴设定位移,position为0时为设原点
  setPositionMotor(
    items: { deviceId: number //电机id
    positionSign: number; position: number }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Operation|setPosition', '0x0003', items, opts)
  }
  // 轴点动
  jogMotor(items: { 
    deviceId: number //电机id
    rangeProtectEnable: number //范围保护
    direction: number//方向

   }[], opts?: CsocketSendOpts) {
    const mapped = items.map((item) => ({
      deviceId: item.deviceId,
      rangeProtectEnable: item.rangeProtectEnable,
      direction: item.direction,
      velocity: 0,
      acceleration: 0,
      deceleration: 0,
    }))
    return this.sendBuilt('Operation|jog', '0x0006', mapped, opts)
  }
  // 绝对位置运动
  moveAbsMotor(
    items: { 
      deviceId: number //电机id
      rangeProtectEnable: number //范围保护
      positionSign: number //位置正负号
      position: number //位置
    }[],
    opts?: CsocketSendOpts,
  ) {
    const mapped = items.map((item) => ({
      deviceId: item.deviceId,
      rangeProtectEnable: item.rangeProtectEnable,
      positionSign: item.positionSign,
      position: item.position,
      velocity: 0,
      acceleration: 0,
      deceleration: 0,
    }))
    return this.sendBuilt('Operation|moveAbs', '0x0007', mapped, opts)
  }
  // 停止
  stopMotor(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    const mapped = items.map((item) => ({
      deviceId: item.deviceId,
      deceleration: 0, // 走默认的减速时间
    }))
    return this.sendBuilt('Operation|stop', '0x0008', mapped, opts)
  }
  // 急停
  eStopMotor(items: { deceleration: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|eStop', '0x0009', items, opts)
  }
  // 扭矩测试
  torqueTestMotor(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|torqueTest', '0x000A', items, opts)
  }
  // 刹车测试
  brakeTestMotor(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|brakeTest', '0x000B', items, opts)
  }
  // 通讯测试
  commTestMotor(items: {
    deviceId: number //电机id
  }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|commTest', '0x000C', items, opts)
  }
  // 配置轴运行参数
  configureAxisRunParamMotor(
    items: {
      paramCount: {
        deviceId: number;
        defaultVelocity: number;
        defaultAcceleration: number;
        defaultDeceleration: number;
        maximumStroke: number;
      };
    }[],
    opts?: CsocketSendOpts,
  ) {
    const mapped = items.map((item) => ({
      paramCount: Object.keys(item.paramCount).length,
      ...item.paramCount,
    }));
    return this.sendBuilt('Config|axis_runconfig', '0x0023', mapped, opts);
  }
  // 读取
  // 读取轴运动状态
  readAxisStateMotor(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readAxisState', '0x0030', items, opts)
  }
  // 读取轴参数
  readAxisStatusMotor(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readAxisParam', '0x0021', items, opts)
  }
  // 读取运行参数
  readAxisRunParamMotor(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readrunconfig', '0x0024', items, opts)
    // return {success: true,data: [{deviceId: 2,defaultVelocity: 40,defaultAcceleration: 40,defaultDeceleration: 40,maximumStroke: 6000}]}
  }
  /*
  * 物体
  */
  // 耦合/解耦（解耦只发 deviceId + coupleFlag）
  coupleModel(
    items: {
      deviceId: number
      coupleFlag: number
      hPosition?: number
      pPosition?: number
      yPosition?: number
    }[],
    opts?: CsocketSendOpts,
  ) {
    const mapped = items.map((item) =>
      item.coupleFlag === 0
        ? { deviceId: item.deviceId, coupleFlag: item.coupleFlag }
        : item,
    )
    return this.sendBuilt('Operation|couple', '0x0101', mapped, opts)
  }
  // 物体使能/断使能
  enableModel(items: {
    deviceId: number,//物体id
    enableFlag: number//使能标志
   }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|enable', '0x0102', items, opts)
  }
  // 物体复位
  resetModel(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|reset', '0x0103', items ?? [], opts)
  }
  // 物体点动
  jogModel(
    items: {
      deviceId: number,//物体id
      virtualAxisType: number,//虚轴类型 0为虚轴1 1为虚轴2 2为虚轴3
      direction: number,//方向
      velocity: number,//速度
      acceleration: number,//加速度
      deceleration: number,//减速度
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Operation|jog', '0x0104', items, opts)
  }
  // 目标位置运动（三轴）
  moveTargetModel(
    items: {
      deviceId: number,//物体id
      hTargetPosition: number,//虚轴1目标位置
      hVelocity: number,//虚轴1速度
      hAcceleration: number,//虚轴1加速度
      hDeceleration: number,//虚轴1减速度
      pTargetPosition: number,//虚轴2目标位置
      pVelocity: number,//虚轴2速度
      pAcceleration: number,//虚轴2加速度
      pDeceleration: number,//虚轴2减速度
      yTargetPosition: number,//虚轴3目标位置
      yVelocity: number,//虚轴3速度
      yAcceleration: number,//虚轴3加速度
      yDeceleration: number,//虚轴3减速度
      moveDirection: number,//移动方向 0为自动 1为正向 2为反向
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Operation|moveTarget', '0x0105', items, opts)
  }
  //  动作 同步模型目标位置运动预备（仅内部调用，不暴露 IPC）
  private syncMovePrepare(
    items: {
      actionId: number
      modelList: unknown[]
      IOBlockList: unknown[]
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Opera|syncMovePrepare', '0x010A', items, opts)
  }
  // 动作 同步模型目标位置运动开始
  syncMovebegin(
    items: {
      actionId: number
      startFlag: number
    }[],
    opts?: CsocketSendOpts,
  ) {
    opts = {
      ...opts,
      paramHeard: items
    }
    return this.sendBuilt('Opera|syncMovebegin', '0x010B', [], opts)
  }
  // 减速停止
  stopModel(items: { deviceId: number, deceleration: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|stop', '0x0107', items, opts)
  }
  // 急停停止
  eStopModel(items: { deviceId: number, deceleration: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|eStop', '0x0108', items, opts)
  }
  // 配置物体参数(含悬挂点)
  configureModelParamModel(
    items: { deviceId: number; paramCount: ModelParamCount }[],
    opts?: CsocketSendOpts,
  ) {
    const mapped = items.map((item) => ({
      paramCount: Object.keys(item.paramCount).length + 1,
      deviceId: item.deviceId,
      ...item.paramCount,
    }))
    return this.sendBuilt('Config|modelParam', '0x012B', mapped, opts)
  }
 
  // 配置轨道绑定
  configureRailBindingModel(
    items: {
      paramCount: {
        railCount: number
        railList: {
          railNo: number
          carCount: number
          carList: { carModelNo: number }[]
        }[]
      }
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|configureRailBinding', '0x012C', items, opts)
  }
  // 读取
  readModelInfo(items: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readModelInfo', '0x012D', items, opts)
  }

  /*
  * PLC 操作
  */
  // 仿真开关
  simulationSwitchPlc(
    items: { deviceId: number, switchFlag: number }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Operation|simulationSwitch', '0x1001', items, opts)
  }
  // 全场停止
  allStopPlc(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|AllStop', '0x1002', items ?? [], opts)
  }
  // 总线复位
  busResetPlc(items: { deviceId: number, busNo: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|busReset', '0x1003', items, opts)
  }
  // PLC复位
  resetPlc(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|plcReset', '0x1004', items ?? [], opts)
  }
  // 动作预演/准备
  actionPreparePlc(
    items: {
      syncGroupId: number
      startMode: number
      runDirection: number
      speedScale: number
      loopCount: number
      autoPositionCheckFlag: number
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Operation|actionPrepare', '0x1005', items, opts)
  }
  // 动作同步调用
  actionSyncCallPlc(
    items: {
      syncGroupId: number
      startMode: number
      runDirection: number
      speedScale: number
      loopCount: number
      autoPositionCheckFlag: number
      startTimestamp: number
    }[],
    opts?: CsocketSendOpts,
  ) {
    console.log('actionSyncCallPlc', JSON.stringify(items));
    return this.sendBuilt('Operation|actionSyncCall', '0x1006', items, opts)
  }
  // 停止动作
  stopActionPlc(items: { deviceId: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|stopAction', '0x1007', items ?? [], opts)
  }
  // 动作数据保存
  actionDataSavePlc(
    items: ActionDataSaveItem[],
    opts?: CsocketSendOpts,
  ) {
    const mapped = items.map((item) => ({
      actionId: item.actionId,
      checkCode: 0,
      safeGroup: 0,
      totalDuration: item.totalDuration,
      deviceCount: item.timelineCount
    }))
    opts = {
      ...opts,
      paramHeard: mapped
    }
    const paramsMapped: any[] = []
    items.forEach((item) => {
      item.timelineList.forEach((timelineItem) => {
        paramsMapped.push({
          deviceId: timelineItem.modelId,
          virtualAxisNo: timelineItem.virtualAxisNo,
          segmentCount: timelineItem.segmentCount,
          segmentList: timelineItem.segmentList
        })
      })
    })
    return this.sendBuilt('Config|actionDataSave', '0x1016', paramsMapped, opts)
  }
  
  // 规则启动
  ruleStartPlc(items: { enableFlag: number }[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|ruleStart', '0x1008', items, opts)
  }
  // 规则删除
  ruleDeletePlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Operation|ruleDelete', '0x1009', items ?? [], opts)
  }
  // 同步电机
  syncMotorPlc(
    items: {
      parentId: number,// 对应PLC的设备ID
      deviceId: number,// 电机id
      deviceType: number,// 电机类型
      deviceIndex: number,// 电机索引
      busNo: number,// 从站口
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|addAxis', '0x1010', items, opts)
  }
  // 删除电机：同步剩余电机列表
  deleteMotorPlc(
    items: {
      parentId: number,// 对应PLC的设备ID
      deviceId: number,// 电机id
      deviceType: number,// 电机类型
      deviceIndex: number,// 电机索引
      busNo: number,// 从站口
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.syncMotorPlc(items, opts)
  }
  // 增加物体
  addModelPlc(
    items: {
      deviceId: number,// 物体id
      deviceType: number,// 物体类型
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|addModel', '0x1011', items, opts)
  }
  // 删除物体
  deleteModelPlc(
    items: {
      deviceId: number,// 物体id
      deviceType: number,// 物体类型
    }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|deleteModel', '0x1012', items, opts)
  }
  // 下载PLC信息
  downloadPlcInfoPlc(
    items: { paramCount: { plcNo: number } }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|downloadPLCInfo', '0x1048', items, opts)
  }
  // 清除配置
  clearConfigPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Config|clearConfig', '0x1049', items ?? [], opts)
  }
  
  // 断开运动配置关联
  disconnectMotionConfigPlc(
    items: { motionFlag: number }[],
    opts?: CsocketSendOpts,
  ) {
    return this.sendBuilt('Config|disconnectMotionConfig', '0x104C', items, opts)
  }

  /*
  * PLC 读取 / 状态查询
  */
  // 项目校验
  projectVerifyPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|projectVerify', '0x104D', items ?? [], opts)
  }
  // 扫描主站
  scanMasterPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|scanMaster', '0x104E', items ?? [], opts)
  }
  // 读取从站设备
  readSlaveDevicesPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readSlaveDevices', '0x104F', items ?? [], opts)
  }
  // 从站通讯异常
  slaveCommErrorPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|slaveCommError', '0x1050', items ?? [], opts)
  }
  // 读取规则列表
  readRuleListPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|readRuleList', '0x1051', items ?? [], opts)
  }
  // 自动列表读取
  autoListReadPlc(items?: unknown[], opts?: CsocketSendOpts) {
    return this.sendBuilt('Information|autoListRead', '0x1052', items ?? [], opts)
  }
  // 读取主控状态（轮询）
  // readMasterStatusPollingPlc(items?: unknown[], opts?: CsocketSendOpts) {
  //   return this.sendBuilt('Information|readMasterStatusPolling', '0x1053', items ?? [], opts)
  // }
  // // 读取物体信息（轮询）
  // readModelInfoPollingPlc(items?: unknown[], opts?: CsocketSendOpts) {
  //   return this.sendBuilt('Information|readModelInfoPolling', '0x1054', items ?? [], opts)
  // }
  // // 读取轴信息（轮询）
  // readAxisInfoPollingPlc(items?: unknown[], opts?: CsocketSendOpts) {
  //   return this.sendBuilt('Information|readAxisInfoPolling', '0x1055', items ?? [], opts)
  // }
  // 时钟同步
  // clockSyncPlc(items?: unknown[], opts?: CsocketSendOpts) {
  //   return this.sendBuilt('Operation|clockSync', '0x1056', items ?? [], opts)
  // }
}
