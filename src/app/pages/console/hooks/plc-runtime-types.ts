export type ScannedAxis = {
  busNo: number;// C,D口编号
  slaveNo: number; // 电机编号
  gourdNo: number;// 产品型号id 对应productModel，先暂时要建立索引表，gourdNo == 1对应 "YZ_AXIS_HOIST_500KG"
};

export type ScannedMaster = {
  ip: string;
  plcModel: number;
  axis: ScannedAxis[];
};

export type PlcConnectionState = "disconnected" | "connecting" | "connected" | "abnormal";

export type PlcAbnormalReason = "timeout" | "authentication" | "countMismatch" | "scanFailed";

/** 主控配置/初始化生命周期（与 connection、simulation 正交） */
export type PlcLifecycle =
  | "configuring"
  | "configFailed"
  | "initializing"
  | "suspended"
  | "normal";

export type DiscoveredMotor = {
  id: string;
  serialNumber: string;
  nodeAddress?: string | null;
  productModel?: string;
};

export type PlcRuntimeState = {
  plcId: number;
  connection: PlcConnectionState;
  /** 连接异常原因（对账/树用） */
  reason?: PlcAbnormalReason;
  /** 仿真意图开关（本阶段仅 runtime，不落盘） */
  simulation: boolean;
  /** 系统状态生命周期 */
  lifecycle: PlcLifecycle;
  /** 挂起 / 配置失败说明 */
  lifecycleReason?: string;
  discoveredMotors: DiscoveredMotor[];
  /** 型号不匹配（扫描 plcNo 映射 != 配置 masterTypeId） */
  modelMismatch?: boolean;
  /** 顺序对账用的扫描轴列表 */
  scannedAxes?: ScannedAxis[];
  /** Last CONFIG\|Pro\|verify protocol version for this PLC */
  protocolVersion?: number;
  /** Last CONFIG\|Pro\|verify result: 0 match, 1 mismatch */
  proVerify?: number;
};

export const createDisconnectedPlcRuntime = (plcId: number): PlcRuntimeState => ({
  plcId,
  connection: "disconnected",
  simulation: false,
  lifecycle: "suspended",
  lifecycleReason: "未连接",
  discoveredMotors: [],
});
