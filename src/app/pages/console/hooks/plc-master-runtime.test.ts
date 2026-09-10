import { describe, expect, it } from "vitest";
import { DISCONNECTED_MASTER_STATUS, type PlcMasterStatus } from "@shared/csocket/plc-master-status";
import type { PlcRuntimeState } from "./plc-runtime-types";
import {
  composePlcRuntime,
  mapMasterStatusToRuntimeFields,
  replaceMasterStatusMap,
  resolveSimulationSwitchState,
  shouldApplyMasterStatusSnapshot,
  SIMULATION_SWITCH_CONNECT_TITLE,
} from "./plc-master-runtime";

const item = (
  overrides: Partial<PlcMasterStatus> & { deviceId: number },
): PlcMasterStatus => ({
  plcModel: 1,
  masterStatus: 1,
  simulationStatus: 0,
  busStatus: 0,
  ruleStartStatus: 0,
  ruleId: 0,
  autoRunStatus: 0,
  autoId: 0,
  ...overrides,
});

const runtime = (
  overrides: Partial<PlcRuntimeState> & { plcId: number },
): PlcRuntimeState => ({
  connection: "connected",
  simulation: false,
  lifecycle: "normal",
  discoveredMotors: [],
  ...overrides,
});

describe("mapMasterStatusToRuntimeFields", () => {
  it("maps missing item to disconnected", () => {
    expect(mapMasterStatusToRuntimeFields(undefined)).toEqual({
      connection: "disconnected",
      lifecycle: "suspended",
      lifecycleReason: "未连接",
      simulation: false,
    });
  });

  it("maps protocol masterStatus values", () => {
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: DISCONNECTED_MASTER_STATUS })).connection).toBe("disconnected");
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: 0 })).lifecycle).toBe("initializing");
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: 1 })).lifecycle).toBe("normal");
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: 2 })).lifecycle).toBe("suspended");
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: 3 })).lifecycle).toBe("configuring");
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, masterStatus: 99 })).connection).toBe("disconnected");
  });

  it("treats simulationStatus 1 as simulation", () => {
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, simulationStatus: 1 })).simulation).toBe(true);
    expect(mapMasterStatusToRuntimeFields(item({ deviceId: 1, simulationStatus: 0 })).simulation).toBe(false);
  });
});

describe("replaceMasterStatusMap", () => {
  it("returns null for invalid frames and keeps caller on previous table", () => {
    expect(replaceMasterStatusMap({ success: false, data: [] })).toBeNull();
  });

  it("replaces the whole table including empty", () => {
    const empty = replaceMasterStatusMap({ success: true, data: [] });
    expect(empty).toBeInstanceOf(Map);
    expect(empty?.size).toBe(0);
    const next = replaceMasterStatusMap({
      success: true,
      data: [item({ deviceId: 2, masterStatus: 1 }), { deviceId: "bad" }],
    });
    expect(next?.size).toBe(1);
    expect(next?.get(2)?.masterStatus).toBe(1);
  });
});

describe("shouldApplyMasterStatusSnapshot", () => {
  it("applies only when no event has been received", () => {
    expect(shouldApplyMasterStatusSnapshot(false)).toBe(true);
    expect(shouldApplyMasterStatusSnapshot(true)).toBe(false);
  });
});

describe("composePlcRuntime", () => {
  it("does not let scanAll override connection", () => {
    const masterById = new Map([
      [1, item({ deviceId: 1, masterStatus: DISCONNECTED_MASTER_STATUS })],
    ]);
    const result = composePlcRuntime(1, {
      plcs: [{ id: 1, ip: "10.0.0.1", masterTypeId: "YZ_PLC_AC810_1" }],
      masterById,
      verify: { version: 1, proVerify: 0 },
      scannedMasters: [{ ip: "10.0.0.1", plcModel: 1, axis: [] }],
    });
    expect(result.connection).toBe("disconnected");
    expect(result.protocolVersion).toBe(1);
    expect(result.scannedAxes).toEqual([]);
  });
});

describe("resolveSimulationSwitchState", () => {
  it("is checked only when every PLC is simulating", () => {
    const all = [
      runtime({ plcId: 1, simulation: true }),
      runtime({ plcId: 2, simulation: true }),
    ];
    expect(resolveSimulationSwitchState(all, false).checked).toBe(true);
    expect(
      resolveSimulationSwitchState(
        [runtime({ plcId: 1, simulation: true }), runtime({ plcId: 2, simulation: false })],
        false,
      ).checked,
    ).toBe(false);
  });

  it("blocks turning on when any PLC is disconnected", () => {
    const off = [
      runtime({ plcId: 1, simulation: false, connection: "disconnected" }),
      runtime({ plcId: 2, simulation: false }),
    ];
    const state = resolveSimulationSwitchState(off, false);
    expect(state.checked).toBe(false);
    expect(state.disabled).toBe(true);
    expect(state.title).toBe(SIMULATION_SWITCH_CONNECT_TITLE);
  });

  it("allows turning off while a PLC is disconnected", () => {
    const on = [
      runtime({ plcId: 1, simulation: true, connection: "disconnected" }),
      runtime({ plcId: 2, simulation: true }),
    ];
    const state = resolveSimulationSwitchState(on, false);
    expect(state.checked).toBe(true);
    expect(state.disabled).toBe(false);
  });

  it("disables while busy or in-flight", () => {
    expect(
      resolveSimulationSwitchState([runtime({ plcId: 1, lifecycle: "configuring" })], false).disabled,
    ).toBe(true);
    expect(resolveSimulationSwitchState([runtime({ plcId: 1 })], true).disabled).toBe(true);
    expect(resolveSimulationSwitchState([], false).disabled).toBe(true);
  });
});
