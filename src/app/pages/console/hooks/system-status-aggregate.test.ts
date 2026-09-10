import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@shared/csocket/protocol";
import type { PlcRuntimeState } from "./plc-runtime-types";
import { aggregateSystemStatus } from "./system-status-aggregate";

const base = (overrides: Partial<PlcRuntimeState> & { plcId: string }): PlcRuntimeState => ({
  connection: "connected",
  simulation: false,
  lifecycle: "normal",
  discoveredMotors: [],
  ...overrides,
});

describe("aggregateSystemStatus", () => {
  it("returns unconfigured when no PLCs", () => {
    expect(aggregateSystemStatus([])).toEqual({
      kind: "unconfigured",
      label: "未配置",
      simulatingCount: 0,
      totalCount: 0,
    });
  });

  it("prefers configFailed over suspended and simulation", () => {
    const result = aggregateSystemStatus([
      base({
        plcId: "a",
        lifecycle: "configFailed",
        lifecycleReason: "参数校验失败",
        simulation: true,
      }),
      base({ plcId: "b", lifecycle: "suspended", lifecycleReason: "线路中断", simulation: true }),
      base({ plcId: "c", lifecycle: "normal", simulation: true }),
    ]);
    expect(result.kind).toBe("configFailed");
    expect(result.label).toBe("配置失败");
    expect(result.detail).toBe("参数校验失败");
  });

  it("prefers suspended over initializing and simulation", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", lifecycle: "suspended", lifecycleReason: "线路问题" }),
      base({ plcId: "b", lifecycle: "initializing", simulation: true }),
      base({ plcId: "c", lifecycle: "normal", simulation: true }),
    ]);
    expect(result.kind).toBe("suspended");
    expect(result.detail).toBe("线路问题");
  });

  it("prefers configuring over initializing and simulation", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", lifecycle: "initializing" }),
      base({ plcId: "b", lifecycle: "configuring", simulation: true }),
      base({ plcId: "c", lifecycle: "normal", simulation: true }),
    ]);
    expect(result.kind).toBe("configuring");
  });

  it("shows initializing when no higher-priority lifecycle", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", lifecycle: "initializing" }),
      base({ plcId: "b", lifecycle: "normal", simulation: true }),
    ]);
    expect(result.kind).toBe("initializing");
  });

  it("shows green normal with simulation detail when all normal and all simulating", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", simulation: true }),
      base({ plcId: "b", simulation: true }),
    ]);
    expect(result).toMatchObject({
      kind: "normal",
      label: "正常",
      detail: "仿真",
      simulatingCount: 2,
      totalCount: 2,
    });
  });

  it("does not treat partial simulation as a status (all-or-nothing)", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", simulation: true }),
      base({ plcId: "b", simulation: false }),
    ]);
    expect(result.kind).toBe("normal");
    expect(result.label).toBe("正常");
    expect(result.detail).toBeUndefined();
    expect(result.simulatingCount).toBe(1);
  });

  it("shows normal when all normal and none simulating", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a" }),
      base({ plcId: "b" }),
    ]);
    expect(result.kind).toBe("normal");
    expect(result.label).toBe("正常");
  });

  it("does not use simulation labels while any PLC is not normal", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", simulation: true, lifecycle: "initializing" }),
      base({ plcId: "b", simulation: true, lifecycle: "normal" }),
    ]);
    expect(result.kind).toBe("initializing");
  });

  it("skips versionMismatch and prefers projectMismatch over suspended", () => {
    const result = aggregateSystemStatus([
      base({
        plcId: "a",
        protocolVersion: 2,
        proVerify: 1,
        lifecycle: "suspended",
        lifecycleReason: "未连接",
      }),
      base({
        plcId: "b",
        protocolVersion: PROTOCOL_VERSION,
        proVerify: 1,
        lifecycle: "normal",
      }),
    ]);
    expect(result.kind).toBe("projectMismatch");
    expect(result.label).toBe("工程不匹配");
  });

  it("prefers projectMismatch over normal and simulation", () => {
    const result = aggregateSystemStatus([
      base({
        plcId: "a",
        protocolVersion: PROTOCOL_VERSION,
        proVerify: 1,
        lifecycle: "normal",
        simulation: true,
      }),
      base({
        plcId: "b",
        protocolVersion: PROTOCOL_VERSION,
        proVerify: 0,
        lifecycle: "normal",
        simulation: true,
      }),
    ]);
    expect(result.kind).toBe("projectMismatch");
    expect(result.label).toBe("工程不匹配");
  });

  it("keeps lifecycle status when no verify is reported", () => {
    const result = aggregateSystemStatus([
      base({ plcId: "a", lifecycle: "suspended", lifecycleReason: "未连接" }),
    ]);
    expect(result.kind).toBe("suspended");
    expect(result.label).toBe("挂起");
  });
});
