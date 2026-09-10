import { describe, expect, it } from "vitest";
import {
  buildEnableItems,
  buildHomeMoveTargetItems,
  buildJogModelItems,
  buildResetItems,
  jogMotionParams,
  toModelJogDirection,
  virtualAxisTypeFromDimKey,
} from "./manual-commands";

describe("virtualAxisTypeFromDimKey", () => {
  it("按维度键映射，不按序号", () => {
    expect(virtualAxisTypeFromDimKey("height")).toBe(0);
    expect(virtualAxisTypeFromDimKey("angle")).toBe(0);
    expect(virtualAxisTypeFromDimKey("pitch")).toBe(1);
    expect(virtualAxisTypeFromDimKey("yaw")).toBe(2);
    expect(virtualAxisTypeFromDimKey("unknown")).toBeUndefined();
  });
});

describe("toModelJogDirection", () => {
  it("UI 方向映射到协议", () => {
    expect(toModelJogDirection(1)).toBe(1);
    expect(toModelJogDirection(-1)).toBe(2);
    expect(toModelJogDirection(0)).toBe(0);
  });
});

describe("jogMotionParams", () => {
  it("默认速度全 0", () => {
    expect(jogMotionParams(true, 20, 2)).toEqual({
      velocity: 0,
      acceleration: 0,
      deceleration: 0,
    });
  });

  it("自定义：加速度 = 减速度 = 速度 / 时间，一位小数", () => {
    expect(jogMotionParams(false, 20, 2)).toEqual({
      velocity: 20,
      acceleration: 10,
      deceleration: 10,
    });
    expect(jogMotionParams(false, 5, 2)).toEqual({
      velocity: 5,
      acceleration: 2.5,
      deceleration: 2.5,
    });
  });

  it("时间 <= 0 时加减速度为 0", () => {
    expect(jogMotionParams(false, 20, 0)).toEqual({
      velocity: 20,
      acceleration: 0,
      deceleration: 0,
    });
  });
});

describe("buildEnableItems / buildResetItems", () => {
  it("使能 flag 与多物体", () => {
    expect(buildEnableItems([1, 2], 1)).toEqual([
      { deviceId: 1, enableFlag: 1 },
      { deviceId: 2, enableFlag: 1 },
    ]);
    expect(buildEnableItems([4], 0)).toEqual([{ deviceId: 4, enableFlag: 0 }]);
  });

  it("复位多项", () => {
    expect(buildResetItems([1, 9])).toEqual([{ deviceId: 1 }, { deviceId: 9 }]);
  });
});

describe("buildHomeMoveTargetItems", () => {
  it("三轴位置与速度加减速度全 0", () => {
    expect(buildHomeMoveTargetItems([3, 4])).toEqual([
      {
        deviceId: 3,
        hTargetPosition: 0,
        hVelocity: 0,
        hAcceleration: 0,
        hDeceleration: 0,
        pTargetPosition: 0,
        pVelocity: 0,
        pAcceleration: 0,
        pDeceleration: 0,
        yTargetPosition: 0,
        yVelocity: 0,
        yAcceleration: 0,
        yDeceleration: 0,
        moveDirection: 0,
      },
      {
        deviceId: 4,
        hTargetPosition: 0,
        hVelocity: 0,
        hAcceleration: 0,
        hDeceleration: 0,
        pTargetPosition: 0,
        pVelocity: 0,
        pAcceleration: 0,
        pDeceleration: 0,
        yTargetPosition: 0,
        yVelocity: 0,
        yAcceleration: 0,
        yDeceleration: 0,
        moveDirection: 0,
      },
    ]);
  });
});

describe("buildJogModelItems", () => {
  const base = {
    deviceIds: [8, 9] as const,
    dimKey: "pitch",
    useDefaultSpeed: true,
    velocity: 20,
    accelDecelTime: 2,
  };

  it("按下：轴号 + 方向 + 默认速度 0", () => {
    expect(buildJogModelItems({ ...base, dir: 1 })).toEqual([
      { deviceId: 8, virtualAxisType: 1, direction: 1, velocity: 0, acceleration: 0, deceleration: 0 },
      { deviceId: 9, virtualAxisType: 1, direction: 1, velocity: 0, acceleration: 0, deceleration: 0 },
    ]);
    expect(buildJogModelItems({ ...base, dimKey: "height", dir: -1 })).toEqual([
      { deviceId: 8, virtualAxisType: 0, direction: 2, velocity: 0, acceleration: 0, deceleration: 0 },
      { deviceId: 9, virtualAxisType: 0, direction: 2, velocity: 0, acceleration: 0, deceleration: 0 },
    ]);
  });

  it("抬起 direction=0，其余与按下相同", () => {
    expect(buildJogModelItems({ ...base, dir: 0 })).toEqual([
      { deviceId: 8, virtualAxisType: 1, direction: 0, velocity: 0, acceleration: 0, deceleration: 0 },
      { deviceId: 9, virtualAxisType: 1, direction: 0, velocity: 0, acceleration: 0, deceleration: 0 },
    ]);
  });

  it("未知维度键返回空数组", () => {
    expect(buildJogModelItems({ ...base, dimKey: "nope", dir: 1 })).toEqual([]);
  });
});
