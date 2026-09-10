import type {
  DeviceConfigCatalog,
  DeviceRegistryEntry,
  DisplayAttribute,
  MotorModelConfig,
  ObjectModelConfig,
  PlcModelConfig,
} from "@shared/config";

export type MotorDriveParams = Record<string, number | boolean | string>;

const motorCache = new Map<string, MotorModelConfig>();
const plcCache = new Map<string, PlcModelConfig>();
const objectCache = new Map<string, ObjectModelConfig>();
let catalogCache: DeviceConfigCatalog | null = null;

/** 工程 productModel = MotorModelConfig.id = device.id */
export const productModelKey = (config: MotorModelConfig): string => config.id;

export const getCachedCatalog = (): DeviceConfigCatalog | null => catalogCache;

export const getMotorRegistryEntries = (): DeviceRegistryEntry[] => {
  if (!catalogCache) return [];
  return catalogCache.motors.map((motor) => ({
    label: motor.name,
    productModel: productModelKey(motor),
    configPath: motor.configPath ?? `/motors/${productModelKey(motor)}`,
  }));
};

export const getPlcRegistryEntries = (): DeviceRegistryEntry[] => {
  if (!catalogCache) return [];
  return catalogCache.plcs.map((plc) => ({
    label: plc.name,
    productModel: plc.id,
    configPath: plc.configPath ?? `/plcs/${plc.id}`,
  }));
};

export const getDefaultPlcRegistryEntry = (): DeviceRegistryEntry =>
  getPlcRegistryEntries()[0] ?? {
    label: "AC810 PLC 环网",
    productModel: "AC810_1",
    configPath: "/plcs/AC810_1",
  };

export const findPlcRegistryEntry = (productModel: string): DeviceRegistryEntry =>
  getPlcRegistryEntries().find((entry) => entry.productModel === productModel) ??
  getDefaultPlcRegistryEntry();

/** 主控型号映射：plcModel（1/2/3...）→ masterTypeId（暂用，后续换正式型号表） */
export const PLC_MODEL_TO_MASTER_TYPE: Record<number, string> = {
  4: "AC802_0",
};

export const resolveMasterTypeIdByPlcModel = (plcModel: number): string =>
  PLC_MODEL_TO_MASTER_TYPE[plcModel] ?? getDefaultPlcRegistryEntry().productModel;

/** 产品型号索引映射：gourdNo → productModel（暂用，后续换正式型号表） */
export const GOURD_NO_TO_PRODUCT_MODEL: Record<number, string> = {
  253: "YZ_AXIS_HOIST_500KG",
};

export const resolveProductModelByGourdNo = (gourdNo: number): string =>
  GOURD_NO_TO_PRODUCT_MODEL[gourdNo] ?? getDefaultMotorRegistryEntry().productModel;

/** 主控型号 id：catalog 命中则用，否则回退默认描述文件 id */
export const resolvePlcMasterTypeId = (masterTypeId: string): string => {
  if (getCachedPlcModelConfig(masterTypeId) || getPlcRegistryEntries().some((e) => e.productModel === masterTypeId)) {
    return masterTypeId;
  }
  return getDefaultPlcRegistryEntry().productModel;
};

export const plcModelSelectOptions = () =>
  getPlcRegistryEntries().map((entry) => ({
    label: entry.label,
    value: entry.productModel,
  }));

export const getObjectRegistryEntries = (): DeviceRegistryEntry[] => {
  if (!catalogCache) return [];
  return catalogCache.objects.map((object) => ({
    label: object.name,
    productModel: object.id,
    configPath: object.configPath ?? `/objects/${object.id}`,
  }));
};

export const getDefaultMotorRegistryEntry = (): DeviceRegistryEntry =>
  getMotorRegistryEntries()[0] ?? {
    label: "500KG 数控葫芦轴",
    productModel: "YZ_AXIS_HOIST_500KG",
    configPath: "/motors/SV660",
  };

export const findMotorRegistryEntry = (productModel: string): DeviceRegistryEntry =>
  getMotorRegistryEntries().find((entry) => entry.productModel === productModel) ??
  getDefaultMotorRegistryEntry();

/** 型号显示名：优先描述文件 device.name，否则回退 productModel */
export const resolveMotorModelName = (productModel: string): string => {
  const cached = getCachedMotorModelConfig(productModel);
  if (cached?.name?.trim()) return cached.name.trim();
  const entry = getMotorRegistryEntries().find((e) => e.productModel === productModel);
  if (entry?.label?.trim()) return entry.label.trim();
  return productModel;
};

export const motorModelSelectOptions = () =>
  getMotorRegistryEntries().map((entry) => ({
    label: entry.label,
    value: entry.productModel,
  }));

export const defaultParamsFromAttributes = (
  attributes: readonly DisplayAttribute[],
): MotorDriveParams => {
  const params: MotorDriveParams = {};
  for (const attr of attributes) {
    if (attr.DefaultValue === undefined) continue;
    params[attr.id] = attr.DefaultValue;
  }
  return params;
};

export const getCachedMotorModelConfig = (
  productModel: string,
): MotorModelConfig | undefined => motorCache.get(productModel);

/** 电机扩展状态参数：合并所有型号的 variableStateAttri，按 id 去重 */
export const getExtendedStateAttrs = (
  productModels: readonly string[],
): DisplayAttribute[] => {
  const seen = new Set<string>();
  const out: DisplayAttribute[] = [];
  for (const productModel of productModels) {
    const config = getCachedMotorModelConfig(productModel);
    for (const attr of config?.variableStateAttri ?? []) {
      if (seen.has(attr.id)) continue;
      seen.add(attr.id);
      out.push(attr);
    }
  }
  return out;
};

export const getCachedPlcModelConfig = (productModel: string): PlcModelConfig | undefined =>
  plcCache.get(productModel);

export const getCachedObjectModelConfig = (
  productModel: string,
): ObjectModelConfig | undefined => objectCache.get(productModel);

export const loadDeviceCatalog = async (): Promise<DeviceConfigCatalog | null> => {
  if (catalogCache) return catalogCache;
  if (typeof window === "undefined" || !window.configAPI?.getCatalog) return null;

  const result = await window.configAPI.getCatalog();
  if (!result.ok) {
    console.warn("[motor-config] getCatalog failed", result);
    return null;
  }

  catalogCache = result.data;
  for (const motor of result.data.motors) {
    motorCache.set(productModelKey(motor), motor);
  }
  for (const plc of result.data.plcs) {
    plcCache.set(plc.id, plc);
  }
  for (const object of result.data.objects) {
    objectCache.set(object.id, object);
  }
  console.log("[motor-config] loadDeviceCatalog", motorCache, plcCache, objectCache);
  return catalogCache;
};

export const loadMotorModelConfig = async (
  productModel: string,
): Promise<MotorModelConfig | null> => {
  await loadDeviceCatalog();
  return getCachedMotorModelConfig(productModel) ?? null;
};

export const loadPlcModelConfig = async (
  productModel: string,
): Promise<PlcModelConfig | null> => {
  await loadDeviceCatalog();
  return getCachedPlcModelConfig(productModel) ?? null;
};

export const loadObjectModelConfig = async (
  productModel: string,
): Promise<ObjectModelConfig | null> => {
  await loadDeviceCatalog();
  return getCachedObjectModelConfig(productModel) ?? null;
};

export const preloadMotorModelConfigs = async (): Promise<void> => {
  await loadDeviceCatalog();
};

/** Sync defaults from cache; empty object if config not yet loaded */
export const defaultMotorParamsFromModel = (productModel: string): MotorDriveParams => {
  const config = getCachedMotorModelConfig(productModel);
  if (!config) return {};
  return {
    ...defaultParamsFromAttributes(config.configAttributes),
    ...defaultParamsFromAttributes(config.variableConfig),
  };
};
