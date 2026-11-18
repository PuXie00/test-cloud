import { describe, expect, it } from "vitest";
import type { Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  discoveredAxesThrough,
  formatRealAxisModel,
  formatRealAxisPosition,
  reconcilePlcOnline,
  filterNewMasters,
  toRealAxes,
} from "./plc-online";
import type { ScannedAxis, ScannedMaster } from "./plc-runtime-types";

const HOIST = "YZ_AXIS_HOIST_500KG"; // gourdNo 253
const plc = { id: 1, ip: "192.168.1.30", masterTypeId: "AC802_0" }; // plcModel 4

const motor = (id: number, busNo: 0 | 1, productModel = HOIST, plcId = 1): Motor =>
  ({
    id,
    productModel,
    plcId,
    busNo,
    axisType: 0,
    nodeAddress: null,
    discoveryId: null,
    selected: true,
    controlledObjectId: null,
    axisKey: null,
    params: {},
  }) as Motor;

const ax = (busNo: number, slaveNo: number, gourdNo = 253): ScannedAxis => ({ busNo, slaveNo, gourdNo });

const master = (axis: ScannedAxis[], ip = plc.ip, plcModel = 4): ScannedMaster => ({ ip, plcModel, axis });

const statusOf = (online: ReturnType<typeof reconcilePlcOnline>, id: number) =>
  online.motorById.get(id)?.status;

describe("reconcilePlcOnline", () => {
  it("还没扫描时主控未扫描、电机状态未知", () => {
    const online = reconcilePlcOnline(plc, [motor(10, 0)], null);
    expect(online.kind).toBe("unscanned");
    expect(statusOf(online, 10)).toBe("unknown");
    expect(online.hasDiff).toBe(false);
  });

  it("扫描里没有这个 IP 就离线，电机全部离线", () => {
    const online = reconcilePlcOnline(plc, [motor(10, 0)], [master([ax(0, 0)], "192.168.1.99")]);
    expect(online.kind).toBe("offline");
    expect(statusOf(online, 10)).toBe("offline");
    expect(online.realAxisCount).toBe(0);
  });

  it("IP 前后空格不影响匹配", () => {
    const online = reconcilePlcOnline({ ...plc, ip: " 192.168.1.30 " }, [], [master([], "192.168.1.30 ")]);
    expect(online.kind).toBe("online");
  });

  it("电机按同口顺序对实轴：C 口对 C 口、D 口对 D 口，与工程里先后穿插无关", () => {
    // 工程顺序 D、C、C；实轴 C0 C1 D2（从站号全局）
    const motors = [motor(20, 1), motor(10, 0), motor(11, 0)];
    const online = reconcilePlcOnline(plc, motors, [master([ax(1, 2), ax(0, 1), ax(0, 0)])]);
    expect(online.kind).toBe("online");
    expect(statusOf(online, 10)).toBe("online");
    expect(online.motorById.get(10)?.axis).toMatchObject({ busNo: 0, index: 0, slaveNo: 0 });
    expect(online.motorById.get(11)?.axis).toMatchObject({ busNo: 0, index: 1, slaveNo: 1 });
    expect(online.motorById.get(20)?.axis).toMatchObject({ busNo: 1, index: 0, slaveNo: 2 });
    expect(online.onlineCount).toBe(3);
    expect(online.hasDiff).toBe(false);
  });

  it("C 口多出实轴不会把 D 口电机挤成不匹配", () => {
    const motors = [motor(10, 0), motor(20, 1)];
    const online = reconcilePlcOnline(plc, motors, [master([ax(0, 0), ax(0, 1), ax(1, 2)])]);
    expect(statusOf(online, 10)).toBe("online");
    expect(statusOf(online, 20)).toBe("online");
    expect(online.discovered).toEqual([
      { busNo: 0, index: 1, slaveNo: 1, gourdNo: 253, productModel: HOIST },
    ]);
    expect(online.hasDiff).toBe(true);
  });

  it("口上实轴不够时多出来的电机离线", () => {
    const online = reconcilePlcOnline(plc, [motor(10, 0), motor(11, 0)], [master([ax(0, 0)])]);
    expect(statusOf(online, 10)).toBe("online");
    expect(statusOf(online, 11)).toBe("offline");
    expect(online.realAxisCount).toBe(1);
    expect(online.configuredCount).toBe(2);
  });

  it("实轴型号与电机型号不同、或型号码认不出，都算型号不符", () => {
    const motors = [motor(10, 0, "YZ_AXIS_HOIST_2000KG"), motor(11, 0)];
    const online = reconcilePlcOnline(plc, motors, [master([ax(0, 0), ax(0, 1, 99)])]);
    expect(statusOf(online, 10)).toBe("modelMismatch");
    expect(statusOf(online, 11)).toBe("modelMismatch");
    expect(online.motorById.get(11)?.axis?.productModel).toBeNull();
    expect(online.onlineCount).toBe(0);
  });

  it("主控型号码对不上工程配置（或认不出）就型号不匹配", () => {
    expect(reconcilePlcOnline(plc, [], [master([])]).modelMatch).toBe(true);
    const other = reconcilePlcOnline({ ...plc, masterTypeId: "AC810_1" }, [], [master([])]);
    expect(other.modelMatch).toBe(false);
    expect(other.hasDiff).toBe(true);
    const unknown = reconcilePlcOnline(plc, [], [master([], plc.ip, 77)]);
    expect(unknown.scannedMasterTypeId).toBeNull();
    expect(unknown.modelMatch).toBe(false);
  });

  it("只看自己主控的电机", () => {
    const online = reconcilePlcOnline(plc, [motor(10, 0), motor(30, 0, HOIST, 2)], [master([ax(0, 0)])]);
    expect(online.configuredCount).toBe(1);
    expect(online.motorById.has(30)).toBe(false);
  });
});

describe("real axis helpers", () => {
  it("实轴按口分组、口内按从站号排；位置名和电机名后缀一致", () => {
    const axes = toRealAxes([ax(1, 5), ax(0, 3), ax(0, 1), ax(2, 9)]);
    expect(axes.map(formatRealAxisPosition)).toEqual(["C-1", "C-2", "D-1"]);
    expect(formatRealAxisModel(axes[0]!)).toBe(HOIST);
    expect(formatRealAxisModel({ gourdNo: 99, productModel: null })).toBe("未知型号 99");
  });

  it("加入一根待加入实轴时带上同口前面的", () => {
    const online = reconcilePlcOnline(plc, [motor(10, 0)], [
      master([ax(0, 0), ax(0, 1), ax(0, 2), ax(1, 3)]),
    ]);
    const through = discoveredAxesThrough(online, { busNo: 0, index: 2 });
    expect(through.map(formatRealAxisPosition)).toEqual(["C-2", "C-3"]);
    expect(discoveredAxesThrough(online, { busNo: 1, index: 0 }).map(formatRealAxisPosition)).toEqual([
      "D-1",
    ]);
  });
});

describe("filterNewMasters", () => {
  it("只留工程里没有的 IP，同一 IP 只算一次", () => {
    const masters = [
      master([ax(0, 0)]),
      master([ax(0, 0)], "192.168.1.31"),
      master([], "192.168.1.31"),
    ];
    expect(filterNewMasters(masters, [{ ip: " 192.168.1.30" }]).map((item) => item.ip)).toEqual([
      "192.168.1.31",
    ]);
  });
});
