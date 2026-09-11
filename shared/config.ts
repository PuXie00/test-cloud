/**
 * 设备描述文件（motor / plc / object）解析后的共享数据契约。
 *
 * main 进程从 Configs/ 下的 JSON 描述文件解析出下列结构，通过 IPC
 * (`CONFIG_CHANNELS.getCatalog`) 暴露给渲染进程。渲染进程仅依赖这里的类型，
 * 不直接读取磁盘。
 */

/** main ⇆ renderer 的设备配置 IPC 通道名。 */
export const CONFIG_CHANNELS = {
  getCatalog: 'config:get-catalog',
} as const

/** 统一的 IPC 结果包裹：成功携带 data，失败携带 error。 */
export type ConfigResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/** 枚举取值对：[值, 显示文案]。 */
export type EnumValue = [number | string, string]

/** 展示属性（配置项 / 状态项），对应描述文件的 configurationAttributes / stateAttributes。 */
export type DisplayAttribute = {
  id: string
  label: string
  dataType: string
  /** basic：固定字段；variable：随描述文件动态出现的字段。 */
  type?: 'variable' | 'basic'
  display?: boolean
  unit?: string
  DefaultValue?: number | string | boolean
  byteLength?: number
  scale?: number
  min?: number
  max?: number
  values?: EnumValue[]
}

/** 动态操作触发类型。 */
export type OperationKind = 'button' | 'formButton' | 'holdButton'

/** 操作返回字段（可嵌套 items）。 */
export type OperationResponseField = {
  id: string
  label?: string
  dataType?: string
  byteLength?: number
  unit?: string
  scale?: number
  min?: number
  max?: number
  values?: EnumValue[]
  items?: OperationResponseField[]
}

/** 操作入参字段（可嵌套 items）。 */
export type OperationField = {
  id: string
  label: string
  dataType: string
  byteLength: number
  unit?: string
  DefaultValue?: number | string
  scale?: number
  min?: number
  max?: number
  values?: EnumValue[]
  items?: OperationResponseField[]
}

/** 执行前置条件：state 需等于 value 才允许触发。 */
export type OperationPrecondition = {
  state: string
  value: boolean | number | string
}

/** 动态操作（display:true 的 Operation 条目）。 */
export type DisplayOperation = {
  id: string
  label: string
  transport: string
  type: OperationKind
  group?: string
  addr?: string
  param: OperationField[]
  response: OperationResponseField[]
  display: boolean
  confirmationLevel?: string
  preconditions: OperationPrecondition[]
}

/** 设备型号配置公共部分（plc / object）。 */
export type DeviceModelConfig = {
  id: string
  name: string
  configPath: string
  hardware: Record<string, unknown>
  variableConfig: DisplayAttribute[]
  variableStateAttri: DisplayAttribute[]
  configAttributes: DisplayAttribute[]
  stateAttributes: DisplayAttribute[]
}

/** 电机型号配置：在公共部分之上追加动态操作。 */
export type MotorModelConfig = DeviceModelConfig & {
  variableOperation: DisplayOperation[]
}

/** PLC 型号配置。 */
export type PlcModelConfig = DeviceModelConfig

/** 对象型号配置。 */
export type ObjectModelConfig = DeviceModelConfig

/** 完整设备目录：按类别聚合。 */
export type DeviceConfigCatalog = {
  motors: MotorModelConfig[]
  plcs: PlcModelConfig[]
  objects: ObjectModelConfig[]
}

/** 型号选择注册项：下拉展示与工程持久化用。 */
export type DeviceRegistryEntry = {
  label: string
  productModel: string
  configPath: string
}
