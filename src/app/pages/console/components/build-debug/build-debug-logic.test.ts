import { describe, expect, it } from "vitest";
import type { MotorMonitorSnapshot } from "../monitor-grid/monitor-data";
import {
  evaluateMotorAlarms,
  imbalancedTorqueMotorIds,
  motorStatusFromSnapshot,
  telemetryFromSnapshot,
} from "./build-debug-logic";

const snap = (over: Partial<MotorMonitorSnapshot> = {}): MotorMonitorSnapshot => ({
  id: 1,
  displayName: "M1",
  productModel: "YZ_AXIS_HOIST_500KG",
  live: true,
  status: "ready",
  axisStatus: 2,
  actualPosition: 0,
  actualSpeed: 0,
  actualLoadRate: 0,
  actualTemperature: 30,
  actualTorque: 10,
  actualWeight: 80,
  driveAlarmCode: 0,
  extras: {},
  ...over,
});

describe("build-debug-logic", () => {
  it("flags torque imbalance within an object", () => {
    const ids = imbalancedTorqueMotorIds([
      { id: 1, torque: 20 },
      { id: 2, torque: 40 },
      { id: 3, torque: 22 },
    ]);
    expect(ids).toContain(2);
    expect(ids).not.toContain(1);
  });

  it("evaluates temperature alarm", () => {
    const flags = evaluateMotorAlarms(
      { status: "idle", values: { actualPosition: 0, actualTemperature: 75, actualTorque: 10 } },
      new Set(),
      1,
    );
    expect(flags.temperature).toBe(true);
    expect(flags.any).toBe(true);
  });

  it("evaluates drive alarm code", () => {
    const flags = evaluateMotorAlarms(
      { status: "idle", values: { driveAlarmCode: 7 } },
      new Set(),
      1,
    );
    expect(flags.driveAlarm).toBe(true);
    expect(flags.any).toBe(true);
  });

  it("maps snapshot axisStatus to runtime status", () => {
    expect(motorStatusFromSnapshot(snap({ axisStatus: 3 }))).toBe("moving");
    expect(motorStatusFromSnapshot(snap({ axisStatus: 2 }))).toBe("idle");
    expect(motorStatusFromSnapshot(snap({ axisStatus: 0 }))).toBe("powerOff");
    expect(motorStatusFromSnapshot(snap({ axisStatus: 1 }))).toBe("error");
    expect(motorStatusFromSnapshot(snap({ axisStatus: 3, driveAlarmCode: 7 }))).toBe("moving");
    expect(motorStatusFromSnapshot(snap({ live: false, axisStatus: null }))).toBe("powerOff");
  });

  it("derives telemetry values from snapshot", () => {
    const t = telemetryFromSnapshot(
      snap({ actualPosition: 100, actualTemperature: 40, actualTorque: 20, actualWeight: 88 }),
    );
    expect(t.status).toBe("idle");
    expect(t.values.actualPosition).toBe(100);
    expect(t.values.actualTemperature).toBe(40);
    expect(t.values.actualTorque).toBe(20);
    expect(t.values.actualWeight).toBe(88);

    const empty = telemetryFromSnapshot(undefined);
    expect(empty.status).toBe("powerOff");
    expect(empty.values).toEqual({});
  });
});
