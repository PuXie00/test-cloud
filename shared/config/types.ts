export type ConfigResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type AttrEnumValue = [number, string]

/** basic = 前端固定 UI；variable = 动态 UI（且需 display:true） */
export type AttributeKind = "basic" | "variable"

export type DisplayAttribute = {
  id: string
  label: string
  /** 缺省按 basic 处理 */
  type?: AttributeKind
  addr?: string
  dataType: string
  byteLength?: number
  unit?: string
  DefaultValue?: number | string
  scale?: number
  display: true
  min?: number
  max?: number
  values?: AttrEnumValue[]
}

/** Operation.type：button / formButton / holdButton */
export type OperationKind = "button" | "formButton" | "holdButton"

export type OperationPrecondition = {
  state: string
  value: boolean | number | string
}

/** Operation.response 字段（可仅引用 id，或带完整元数据） */
export type OperationResponseField = {
  id: string
  label?: string
  dataType?: string
  byteLength?: number
  unit?: string
  scale?: number
  min?: number
  max?: number
  values?: AttrEnumValue[]
  items?: OperationResponseField[]
}

/** Operation.param 字段 */
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
  values?: AttrEnumValue[]
  items?: OperationResponseField[]
}

/** 描述文件 Operation[] 中 display:true 的动态操作 */
export type DisplayOperation = {
  id: string
  label: string
  transport: string
  type: OperationKind
  group?: string
  addr?: string
  param: OperationField[]
  response: OperationResponseField[]
  display: true
  confirmationLevel?: string
  preconditions?: OperationPrecondition[]
}

export type MotorModelConfig = {
  /** device.id */
  id: string
  /** device.name */
  name: string
  /** 相对 Configs 根，由扫描写入，如 `/motors/YZ_AXIS_HOIST_500KG` */
  configPath?: string
  hardware: {
    driveModel?: string
    encoderBits?: number
    [key: string]: unknown
  }
  variableConfig: DisplayAttribute[]
  variableStateAttri: DisplayAttribute[]
  configAttributes: DisplayAttribute[]
  stateAttributes: DisplayAttribute[]
  variableOperation: DisplayOperation[]
}

export type PlcModelConfig = {
  /** device.id */
  id: string
  /** device.name */
  name: string
  configPath?: string
  hardware: {
    modelType?: string
    networkType?: string
    [key: string]: unknown
  }
  variableConfig: DisplayAttribute[]
  variableStateAttri: DisplayAttribute[]
  configAttributes: DisplayAttribute[]
  stateAttributes: DisplayAttribute[]
}

export type ObjectModelConfig = {
  /** device.id */
  id: string
  /** device.name */
  name: string
  configPath?: string
  hardware: Record<string, unknown>
  variableConfig: DisplayAttribute[]
  variableStateAttri: DisplayAttribute[]
  configAttributes: DisplayAttribute[]
  stateAttributes: DisplayAttribute[]
}

/** 扫描结果中的选型条目（productModel = device.id） */
export type DeviceRegistryEntry = {
  label: string
  productModel: string
  /** 相对 Configs 根，如 `/motors/SV660` → `Configs/motors/SV660.json` */
  configPath: string
}

export type DeviceConfigCatalog = {
  motors: MotorModelConfig[]
  plcs: PlcModelConfig[]
  objects: ObjectModelConfig[]
}
