import { describe, expect, it } from "vitest";
import {
  axisStatusLabel,
  classifyAxisStatus,
  classifyModelStatus,
  formatMotorAxisStatus,
  modelStatusLabel,
  motorRuntimeStatusFromAxisCode,
} from "./monitor-status";
import { objectStatusBadgeClass, resolveObjectStatusLabel } from "./object-status-badge";
import { RUNTIME_BADGE_STYLES, WARNING_BADGE_STYLE } from "./runtime-status-styles";

describe("classifyAxisStatus", () => {
  it("maps 0-3 and unknown", () => {
    expect(classifyAxisStatus(0)).toBe("offline");
    expect(classifyAxisStatus(1)).toBe("alarm");
    expect(classifyAxisStatus(2)).toBe("ready");
    expect(classifyAxisStatus(3)).toBe("running");
    expect(classifyAxisStatus(9)).toBe("offline");
  });
});

describe("classifyModelStatus", () => {
  it("maps basic states", () => {
    expect(classifyModelStatus(0)).toBe("ready");
    expect(classifyModelStatus(1)).toBe("ready");
    expect(classifyModelStatus(2)).toBe("ready");
    expect(classifyModelStatus(3)).toBe("warning");
    expect(classifyModelStatus(16)).toBe("ready");
    expect(classifyModelStatus(17)).toBe("running");
    expect(classifyModelStatus(255)).toBe("disabled");
  });

  it("falls back to warning for protection range", () => {
    expect(classifyModelStatus(0x31)).toBe("warning");
    expect(classifyModelStatus(0x3f)).toBe("warning");
  });

  it("falls back to alarm for error range", () => {
    expect(classifyModelStatus(0xa1)).toBe("alarm");
    expect(classifyModelStatus(0xef)).toBe("alarm");
  });

  it("falls back to offline for unknown", () => {
    expect(classifyModelStatus(99)).toBe("offline");
  });
});

describe("status labels", () => {
  it("returns known labels", () => {
    expect(axisStatusLabel(0)).toBe("断电");
    expect(axisStatusLabel(1)).toBe("错误");
    expect(axisStatusLabel(2)).toBe("静止");
    expect(axisStatusLabel(3)).toBe("运动");
    expect(modelStatusLabel(0)).toBe("未初始化");
    expect(modelStatusLabel(1)).toBe("未耦合");
    expect(modelStatusLabel(2)).toBe("未耦合");
    expect(modelStatusLabel(3)).toBe("耦合中");
    expect(modelStatusLabel(255)).toBe("禁用");
  });

  it("returns 未知 for unknown", () => {
    expect(axisStatusLabel(9)).toBe("未知");
    expect(modelStatusLabel(99)).toBe("未知");
  });
});

describe("motorRuntimeStatusFromAxisCode", () => {
  it("maps 0-3", () => {
    expect(motorRuntimeStatusFromAxisCode(0)).toBe("powerOff");
    expect(motorRuntimeStatusFromAxisCode(1)).toBe("error");
    expect(motorRuntimeStatusFromAxisCode(2)).toBe("idle");
    expect(motorRuntimeStatusFromAxisCode(3)).toBe("moving");
    expect(motorRuntimeStatusFromAxisCode(null)).toBe("powerOff");
  });
});

describe("formatMotorAxisStatus", () => {
  it("uses the 4-code labels", () => {
    expect(formatMotorAxisStatus({ live: false, axisStatus: 3, driveAlarmCode: 0 })).toBe("断电");
    expect(formatMotorAxisStatus({ live: true, axisStatus: 2, driveAlarmCode: 0 })).toBe("静止");
    expect(formatMotorAxisStatus({ live: true, axisStatus: 3, driveAlarmCode: 0 })).toBe("运动");
    expect(formatMotorAxisStatus({ live: true, axisStatus: 2, driveAlarmCode: 7 })).toBe("错误");
    expect(formatMotorAxisStatus({ live: true, axisStatus: 1, driveAlarmCode: 0 })).toBe("错误");
  });
});

describe("objectStatusBadgeClass", () => {
  it("matches motor runtime colors", () => {
    expect(objectStatusBadgeClass("running")).toBe(RUNTIME_BADGE_STYLES.moving);
    expect(objectStatusBadgeClass("ready")).toBe(RUNTIME_BADGE_STYLES.idle);
    expect(objectStatusBadgeClass("alarm")).toBe(RUNTIME_BADGE_STYLES.error);
    expect(objectStatusBadgeClass("disabled")).toBe(RUNTIME_BADGE_STYLES.powerOff);
    expect(objectStatusBadgeClass("offline")).toBe(RUNTIME_BADGE_STYLES.powerOff);
    expect(objectStatusBadgeClass("warning")).toBe(WARNING_BADGE_STYLE);
  });
});

describe("resolveObjectStatusLabel", () => {
  it("uses MODEL_STATUS copy when a code is present", () => {
    expect(resolveObjectStatusLabel("ready", 0)).toBe("未初始化");
    expect(resolveObjectStatusLabel("ready", 1)).toBe("未耦合");
    expect(resolveObjectStatusLabel("ready", 2)).toBe("未耦合");
    expect(resolveObjectStatusLabel("warning", 3)).toBe("耦合中");
  });

  it("falls back to semantic copy when code is missing or unnamed", () => {
    expect(resolveObjectStatusLabel("offline", null)).toBe("离线");
    expect(resolveObjectStatusLabel("warning", 0x39)).toBe("警告");
  });
});
