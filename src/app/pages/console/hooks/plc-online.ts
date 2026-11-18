import type {
  BusNo,
  Motor,
  Plc,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import { busNoCode } from "./motor-mid";
import {
  lookupMasterTypeIdByPlcModel,
  lookupProductModelByGourdNo,
  resolveMotorModelName,
  resolvePlcModelName,
} from "./motor-config";
import type { ScannedAxis, ScannedMaster } from "./plc-runtime-types";

/**
 * 工程结构里的「在线」只看最近一次扫描主控（Info|scan）的结果：
 * - 主控：扫到它的 IP 就在线，型号码对不上工程配置的型号就标黄；
 * - 电机：按「同一主控、同一从站口、口内顺序」与扫到的实轴一一对应（C-1 ↔ C 口第 1 根实轴），
 *   与下发给 C++ 的 axisIndex 一致；型号对不上标黄，没有对应实轴的算离线，
 *   多出来的实轴是「待加入」。
 * 与主控连接状态（Info|masterStatus）无关。
 */
export type PlcOnlineKind = "unscanned" | "offline" | "online";

export type MotorOnlineStatus = "unknown" | "offline" | "online" | "modelMismatch";

export type RealAxis = {
  busNo: BusNo;
  /** 同一口上的位置（从 0 起） */
  index: number;
  slaveNo: number;
  gourdNo: number;
  /** 型号码在型号表里对应的电机型号；表里没有为 null */
  productModel: string | null;
};

export type MotorOnline = {
  status: MotorOnlineStatus;
  /** 对应的实轴（离线 / 未扫描时为 null） */
  axis: RealAxis | null;
};

export type PlcOnline = {
  plcId: number;
  kind: PlcOnlineKind;
  /** 扫到的主控型号码（未扫到为 null） */
  plcModel: number | null;
  /** 型号码对应的主控型号；型号表里没有为 null */
  scannedMasterTypeId: string | null;
  /** 主控型号与工程配置一致（只在在线时有意义） */
  modelMatch: boolean;
  motorById: ReadonlyMap<number, MotorOnline>;
  /** 扫到但工程里还没有的实轴，按 C 口、D 口和口内顺序 */
  discovered: RealAxis[];
  /** 扫到的实轴数 */
  realAxisCount: number;
  /** 工程里配置的电机数 */
  configuredCount: number;
  /** 在线且型号一致的电机数 */
  onlineCount: number;
  /** 在线但和工程不一致：主控型号、电机型号、离线电机或待加入的实轴 */
  hasDiff: boolean;
};

const BUS_NOS: readonly BusNo[] = [0, 1];

/** 扫描结果的轴按口分组，口内按从站号排序；不认识的口丢掉 */
export const toRealAxes = (axes: readonly ScannedAxis[]): RealAxis[] => {
  const out: RealAxis[] = [];
  for (const busNo of BUS_NOS) {
    axes
      .filter((axis) => axis.busNo === busNo)
      .sort((a, b) => a.slaveNo - b.slaveNo)
      .forEach((axis, index) => {
        out.push({
          busNo,
          index,
          slaveNo: axis.slaveNo,
          gourdNo: axis.gourdNo,
          productModel: lookupProductModelByGourdNo(axis.gourdNo),
        });
      });
  }
  return out;
};

/** 实轴在口上的位置名，与电机显示名的后缀一致：C-1、D-2 */
export const formatRealAxisPosition = (axis: Pick<RealAxis, "busNo" | "index">): string =>
  `${busNoCode(axis.busNo)}-${axis.index + 1}`;

/** 实轴型号显示名；型号表里没有就显示型号码 */
export const formatRealAxisModel = (axis: Pick<RealAxis, "gourdNo" | "productModel">): string =>
  axis.productModel ? resolveMotorModelName(axis.productModel) : `未知型号 ${axis.gourdNo}`;

/** 扫到的主控型号显示名；型号表里没有就显示型号码 */
export const formatScannedPlcModel = (plcModel: number): string => {
  const masterTypeId = lookupMasterTypeIdByPlcModel(plcModel);
  return masterTypeId ? resolvePlcModelName(masterTypeId) : `未知型号 ${plcModel}`;
};

export const normalizeIp = (ip: string): string => ip.trim();

export const findScannedMaster = (
  masters: readonly ScannedMaster[],
  ip: string,
): ScannedMaster | undefined => {
  const key = normalizeIp(ip);
  return key ? masters.find((master) => normalizeIp(master.ip) === key) : undefined;
};

const emptyOnline = (
  plcId: number,
  kind: Exclude<PlcOnlineKind, "online">,
  motors: readonly Motor[],
): PlcOnline => {
  const status: MotorOnlineStatus = kind === "unscanned" ? "unknown" : "offline";
  return {
    plcId,
    kind,
    plcModel: null,
    scannedMasterTypeId: null,
    modelMatch: false,
    motorById: new Map(motors.map((motor) => [motor.id, { status, axis: null }])),
    discovered: [],
    realAxisCount: 0,
    configuredCount: motors.length,
    onlineCount: 0,
    hasDiff: false,
  };
};

/**
 * 一台主控的在线情况。
 * @param motors 这台主控的电机，按工程顺序（同口内的先后就是 C-1、C-2…）
 * @param masters 最近一次扫描结果；还没扫描过传 null
 */
export const reconcilePlcOnline = (
  plc: Pick<Plc, "id" | "ip" | "masterTypeId">,
  motors: readonly Motor[],
  masters: readonly ScannedMaster[] | null,
): PlcOnline => {
  const own = motors.filter((motor) => motor.plcId === plc.id);
  if (masters === null) return emptyOnline(plc.id, "unscanned", own);
  const master = findScannedMaster(masters, plc.ip);
  if (!master) return emptyOnline(plc.id, "offline", own);

  const realAxes = toRealAxes(master.axis ?? []);
  const motorById = new Map<number, MotorOnline>();
  const discovered: RealAxis[] = [];
  let onlineCount = 0;

  for (const busNo of BUS_NOS) {
    const configured = own.filter((motor) => motor.busNo === busNo);
    const real = realAxes.filter((axis) => axis.busNo === busNo);
    configured.forEach((motor, index) => {
      const axis = real[index];
      if (!axis) {
        motorById.set(motor.id, { status: "offline", axis: null });
        return;
      }
      const matches = axis.productModel !== null && axis.productModel === motor.productModel;
      if (matches) onlineCount += 1;
      motorById.set(motor.id, { status: matches ? "online" : "modelMismatch", axis });
    });
    discovered.push(...real.slice(configured.length));
  }
  // 口号不是 C/D 的电机（旧数据）对不上任何实轴
  for (const motor of own) {
    if (!motorById.has(motor.id)) motorById.set(motor.id, { status: "offline", axis: null });
  }

  const scannedMasterTypeId = lookupMasterTypeIdByPlcModel(master.plcModel);
  const modelMatch = scannedMasterTypeId !== null && scannedMasterTypeId === plc.masterTypeId;
  return {
    plcId: plc.id,
    kind: "online",
    plcModel: master.plcModel,
    scannedMasterTypeId,
    modelMatch,
    motorById,
    discovered,
    realAxisCount: realAxes.length,
    configuredCount: own.length,
    onlineCount,
    hasDiff: !modelMatch || onlineCount < own.length || discovered.length > 0,
  };
};

/** 加入某根待加入的实轴时，同口排在它前面的待加入实轴也要一起加入，电机才能按位置对上实轴 */
export const discoveredAxesThrough = (
  online: Pick<PlcOnline, "discovered">,
  target: Pick<RealAxis, "busNo" | "index">,
): RealAxis[] =>
  online.discovered.filter((axis) => axis.busNo === target.busNo && axis.index <= target.index);

export const toScannedAxes = (axes: readonly RealAxis[]): ScannedAxis[] =>
  axes.map(({ busNo, slaveNo, gourdNo }) => ({ busNo, slaveNo, gourdNo }));

/** 扫描结果里工程还没有的主控（按 IP）；同一个 IP 只算第一条 */
export const filterNewMasters = (
  masters: readonly ScannedMaster[],
  plcs: readonly Pick<Plc, "ip">[],
): ScannedMaster[] => {
  const known = new Set(plcs.map((plc) => normalizeIp(plc.ip)).filter(Boolean));
  const seen = new Set<string>();
  const out: ScannedMaster[] = [];
  for (const master of masters) {
    const ip = normalizeIp(master.ip);
    if (seen.has(ip) || (ip && known.has(ip))) continue;
    seen.add(ip);
    out.push(master);
  }
  return out;
};
