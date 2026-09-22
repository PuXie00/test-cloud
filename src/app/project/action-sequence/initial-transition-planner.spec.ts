import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/app/kinematics/multi-point-forward";
import {
  planInitialTransition,
  solveFourPointForward,
  solveTwoPointForward,
  type AxisVad,
  type InitialTransitionModelInput,
  type InitialTransitionModelResult,
} from "./initial-transition-planner";

const SQUARE: Vec3[] = [
  [100, 100, 0],
  [-100, 100, 0],
  [-100, -100, 0],
  [100, -100, 0],
];

const vad = (velocity: number, acceleration: number, deceleration: number): AxisVad => ({
  velocity,
  acceleration,
  deceleration,
});

const pose = (h: number, p: number, y: number) => ({ h, p, y });

const fromTriples = (
  current: [number, number, number],
  target: [number, number, number],
  velocity: [number, number, number],
  acceleration: [number, number, number],
  deceleration: [number, number, number],
  maxMotorVelocity: number,
) => ({
  current: pose(current[0], current[1], current[2]),
  target: pose(target[0], target[1], target[2]),
  h: vad(velocity[0], acceleration[0], deceleration[0]),
  p: vad(velocity[1], acceleration[1], deceleration[1]),
  y: vad(velocity[2], acceleration[2], deceleration[2]),
  maxMotorVelocity,
});

const expectVad = (actual: AxisVad, expected: AxisVad) => {
  expect(actual.velocity).toBeCloseTo(expected.velocity, 9);
  expect(actual.acceleration).toBeCloseTo(expected.acceleration, 9);
  expect(actual.deceleration).toBeCloseTo(expected.deceleration, 9);
};

const expectModel = (
  actual: InitialTransitionModelResult,
  expected: {
    id?: number;
    type: 1 | 2 | 4 | 8;
    time: number;
    H: AxisVad;
    P: AxisVad;
    Y: AxisVad;
    finalMaxVelocity: number;
    maxMotorVelocity: number;
  },
) => {
  expect(actual.type).toBe(expected.type);
  if (expected.id !== undefined) expect(actual.id).toBe(expected.id);
  expect(actual.time).toBeCloseTo(expected.time, 9);
  expectVad(actual.H, expected.H);
  expectVad(actual.P, expected.P);
  expectVad(actual.Y, expected.Y);
  expect(actual.finalMaxVelocity).toBeCloseTo(expected.finalMaxVelocity, 9);
  expect(actual.maxMotorVelocity).toBe(expected.maxMotorVelocity);
  expect(actual.velocityCheck).toBe(true);
};

const expectPlan = (
  models: readonly InitialTransitionModelInput[],
  totalTime: number,
  expectedModels: Parameters<typeof expectModel>[1][],
) => {
  const plan = planInitialTransition(models);
  expect(plan.totalTime).toBeCloseTo(totalTime, 9);
  expect(plan.models).toHaveLength(expectedModels.length);
  for (const [index, expected] of expectedModels.entries()) {
    expectModel(plan.models[index]!, expected);
  }
};

describe("planInitialTransition", () => {
  it("returns a zero-time plan for no models", () => {
    expect(planInitialTransition([])).toEqual({ totalTime: 0, models: [] });
  });

  it("matches Python type-1 trapezoid (distance covers accel+decel)", () => {
    expectPlan(
      [
        {
          type: 1,
          ...fromTriples([0, 0, 0], [1000, 0, 0], [100, 10, 10], [50, 10, 10], [50, 10, 10], 200),
        },
      ],
      12,
      [
        {
          type: 1,
          time: 12,
          H: vad(100, 50, 50),
          P: vad(10, 10, 10),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 100,
          maxMotorVelocity: 200,
        },
      ],
    );
  });

  it("matches Python type-1 triangle and keeps commanded V/A/D", () => {
    expectPlan(
      [
        {
          type: 1,
          ...fromTriples([0, 0, 0], [40, 0, 0], [100, 10, 10], [50, 10, 10], [50, 10, 10], 200),
        },
      ],
      1.788854381999832,
      [
        {
          type: 1,
          time: 1.788854381999832,
          H: vad(100, 50, 50),
          P: vad(10, 10, 10),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 44.721359549995796,
          maxMotorVelocity: 200,
        },
      ],
    );
  });

  it("returns zero time when current equals target", () => {
    expectPlan(
      [
        {
          type: 1,
          ...fromTriples([100, 0, 0], [100, 0, 0], [100, 10, 10], [50, 10, 10], [50, 10, 10], 200),
        },
      ],
      0,
      [
        {
          type: 1,
          time: 0,
          H: vad(100, 50, 50),
          P: vad(10, 10, 10),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 0,
          maxMotorVelocity: 200,
        },
      ],
    );
  });

  it("slows a type-1 overspeed model by 1.01 and leaves idle P/Y unchanged", () => {
    expectPlan(
      [
        {
          type: 1,
          ...fromTriples([0, 0, 0], [1000, 0, 0], [300, 10, 10], [150, 10, 10], [150, 10, 10], 100),
        },
      ],
      16.16,
      [
        {
          type: 1,
          time: 16.16,
          H: vad(99.009900990099, 16.338267490115346, 16.338267490115346),
          P: vad(10, 10, 10),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 99.009900990099,
          maxMotorVelocity: 100,
        },
      ],
    );
  });

  it("syncs two-point H/P on the upper origin (cubic offset)", () => {
    expectPlan(
      [
        {
          type: 2,
          ...fromTriples([0, 0, 0], [500, 20, 0], [200, 5, 10], [100, 8, 10], [80, 6, 10], 400),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          maxHeight: 800,
        },
      ],
      4.75,
      [
        {
          type: 2,
          time: 4.75,
          H: vad(200, 100, 80),
          P: vad(4.978070175438597, 7.929978454909202, 5.947483841181902),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 243.05943868164607,
          maxMotorVelocity: 400,
        },
      ],
    );
  });

  it("matches Python two-point lower origin", () => {
    expectPlan(
      [
        {
          type: 2,
          ...fromTriples([100, -10, 0], [400, 15, 0], [150, 12, 10], [80, 10, 10], [70, 9, 10], 350),
          baseHeight1: 0,
          baseHeight2: 120,
          lengthInside: 1200,
          maxHeight: 800,
        },
      ],
      4.0089186286863665,
      [
        {
          type: 2,
          time: 4.0089186286863665,
          H: vad(150, 80, 70),
          P: vad(10.02764179655416, 6.982888888888886, 6.2845999999999975),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 254.63558811152978,
          maxMotorVelocity: 350,
        },
      ],
    );
  });

  it("applies 1.01 overspeed slowdown on a two-point model", () => {
    expectPlan(
      [
        {
          type: 2,
          ...fromTriples([0, 0, 0], [600, 25, 0], [250, 20, 10], [120, 15, 10], [100, 12, 10], 80),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          maxHeight: 800,
        },
      ],
      20.236703301355586,
      [
        {
          type: 2,
          time: 20.236703301355586,
          H: vad(57.959868719728526, 6.449945053455676, 5.374954211213064),
          P: vad(2.7065799668490276, 0.2747090668855681, 0.21976725350845452),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 79.20792079207921,
          maxMotorVelocity: 80,
        },
      ],
    );
  });

  it("matches Python four-point moveWhat=1 (H/P, upper)", () => {
    expectPlan(
      [
        {
          type: 4,
          ...fromTriples([50, 0, 0], [400, 18, 0], [180, 8, 8], [90, 6, 6], [80, 5, 5], 300),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          widthInside: 800,
          maxHeight: 800,
          moveWhat: 1,
        },
      ],
      4.065436972550156,
      [
        {
          type: 4,
          time: 4.065436972550156,
          H: vad(180, 90, 80),
          P: vad(7.313686950281827, 5.014689075630253, 4.178907563025211),
          Y: vad(8, 6, 5),
          finalMaxVelocity: 235.42557194520805,
          maxMotorVelocity: 300,
        },
      ],
    );
  });

  it("matches Python four-point moveWhat=2 (H/Y, upper) and leaves P unscaled", () => {
    expectPlan(
      [
        {
          type: 4,
          ...fromTriples([50, 0, -5], [350, 0, 12], [180, 8, 7], [90, 6, 5], [80, 5, 4], 300),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          widthInside: 800,
          maxHeight: 800,
          moveWhat: 2,
        },
      ],
      4.003571428571428,
      [
        {
          type: 4,
          time: 4.003571428571428,
          H: vad(169.22275511390583, 79.5453912453915, 70.707014440348),
          P: vad(8, 6, 5),
          Y: vad(7, 5, 4),
          finalMaxVelocity: 198.66117395042627,
          maxMotorVelocity: 300,
        },
      ],
    );
  });

  it("matches Python four-point lower origin on X", () => {
    expectPlan(
      [
        {
          type: 4,
          ...fromTriples([80, 5, 0], [300, -12, 0], [160, 9, 8], [70, 7, 6], [60, 6, 5], 280),
          baseHeight1: 0,
          baseHeight2: 150,
          lengthInside: 900,
          widthInside: 700,
          maxHeight: 900,
          moveWhat: 1,
        },
      ],
      3.6903993847614402,
      [
        {
          type: 4,
          time: 3.6903993847614402,
          H: vad(160, 70, 60),
          P: vad(8.003392372021972, 5.535555879305881, 4.744762182262184),
          Y: vad(8, 6, 5),
          finalMaxVelocity: 182.0070241011639,
          maxMotorVelocity: 280,
        },
      ],
    );
  });

  it("uses height-only four-point motion when moveWhat is neither 1 nor 2", () => {
    expectPlan(
      [
        {
          type: 4,
          ...fromTriples([0, 10, 10], [200, 10, 10], [100, 8, 8], [50, 6, 6], [50, 5, 5], 200),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          widthInside: 800,
          maxHeight: 800,
          moveWhat: 0,
        },
      ],
      4,
      [
        {
          type: 4,
          time: 4,
          H: vad(100, 50, 50),
          P: vad(8, 6, 5),
          Y: vad(8, 6, 5),
          finalMaxVelocity: 100,
          maxMotorVelocity: 200,
        },
      ],
    );
  });

  it("matches Python multi-point quaternion sampling (upper origin)", () => {
    expectPlan(
      [
        {
          type: 8,
          id: 0,
          ...fromTriples([200, 0, 0], [400, 10, 8], [120, 6, 5], [60, 4, 3], [50, 3, 2], 250),
          baseHeight1: 80,
          baseHeight2: 0,
          maxHeight: 800,
          betaInit: 0,
          pointInitPos: SQUARE,
        },
      ],
      3.8297084310253524,
      [
        {
          type: 8,
          time: 3.8297084310253524,
          H: vad(120, 60, 50),
          P: vad(5.351295510095068, 3.181818181818181, 2.386363636363636),
          Y: vad(4.767312946227961, 2.727272727272727, 1.8181818181818181),
          finalMaxVelocity: 112.80850601302565,
          maxMotorVelocity: 250,
        },
      ],
    );
  });

  it("matches Python multi-point lower origin with betaInit", () => {
    expectPlan(
      [
        {
          type: 8,
          ...fromTriples([150, 5, -4], [320, -8, 12], [100, 8, 6], [50, 5, 4], [40, 4, 3], 220),
          baseHeight1: 0,
          baseHeight2: 120,
          maxHeight: 800,
          betaInit: 90,
          pointInitPos: SQUARE,
        },
      ],
      4.416666666666666,
      [
        {
          type: 8,
          time: 4.416666666666666,
          H: vad(88.56274965558318, 39.21680313278749, 31.373442506229992),
          P: vad(6.1956702345009775, 2.9989320042719836, 2.399145603417587),
          Y: vad(6, 4, 3),
          finalMaxVelocity: 86.80106992207709,
          maxMotorVelocity: 220,
        },
      ],
    );
  });

  it("slows a multi-point overspeed model by 1.01 then revalidates", () => {
    expectPlan(
      [
        {
          type: 8,
          ...fromTriples([100, 0, 0], [500, 20, 15], [200, 15, 12], [100, 10, 8], [80, 8, 6], 120),
          baseHeight1: 80,
          baseHeight2: 0,
          maxHeight: 800,
          betaInit: 45,
          pointInitPos: SQUARE,
        },
      ],
      7.3893341519382005,
      [
        {
          type: 8,
          time: 7.3893341519382005,
          H: vad(114.83147466017499, 32.965668931576026, 26.37253514526082),
          P: vad(6.089858581939569, 1.648283446578801, 1.3186267572630408),
          Y: vad(4.8037452318064515, 1.2819982362279565, 0.9614986771709674),
          finalMaxVelocity: 119.86659500234613,
          maxMotorVelocity: 120,
        },
      ],
    );
  });

  it("globally syncs a fast type-1 model to a slower type-2 model", () => {
    expectPlan(
      [
        {
          type: 1,
          id: 0,
          ...fromTriples([0, 0, 0], [200, 0, 0], [200, 10, 10], [100, 10, 10], [100, 10, 10], 400),
        },
        {
          type: 2,
          id: 1,
          ...fromTriples([0, 0, 0], [800, 30, 0], [80, 3, 10], [40, 2, 10], [40, 2, 10], 300),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1000,
          maxHeight: 800,
        },
      ],
      12,
      [
        {
          id: 0,
          type: 1,
          time: 12,
          H: vad(47.14045207910317, 5.555555555555556, 5.555555555555556),
          P: vad(10, 10, 10),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 33.333333333333336,
          maxMotorVelocity: 400,
        },
        {
          id: 1,
          type: 2,
          time: 12,
          H: vad(80, 40, 40),
          P: vad(2.875, 1.8368055555555556, 1.8368055555555556),
          Y: vad(10, 10, 10),
          finalMaxVelocity: 105.04907227173165,
          maxMotorVelocity: 300,
        },
      ],
    );
  });

  it("globally syncs mixed 1/4/8 hoist types and preserves ids", () => {
    expectPlan(
      [
        {
          type: 1,
          id: 7,
          ...fromTriples([10, 0, 0], [110, 0, 0], [50, 1, 1], [25, 1, 1], [25, 1, 1], 200),
        },
        {
          type: 4,
          id: 8,
          ...fromTriples([0, 0, 0], [250, 10, 0], [100, 5, 5], [50, 4, 4], [40, 3, 3], 250),
          baseHeight1: 80,
          baseHeight2: 0,
          lengthInside: 1100,
          widthInside: 900,
          maxHeight: 1000,
          moveWhat: 1,
        },
        {
          type: 8,
          id: 9,
          ...fromTriples([0, 0, 0], [180, 6, 4], [90, 4, 3], [45, 3, 2], [40, 2, 2], 200),
          baseHeight1: 80,
          baseHeight2: 0,
          maxHeight: 800,
          betaInit: 0,
          pointInitPos: SQUARE,
        },
      ],
      4.75,
      [
        {
          id: 7,
          type: 1,
          time: 4.75,
          H: vad(42.10526315789474, 17.72853185595568, 17.72853185595568),
          P: vad(1, 1, 1),
          Y: vad(1, 1, 1),
          finalMaxVelocity: 42.10526315789474,
          maxMotorVelocity: 200,
        },
        {
          id: 8,
          type: 4,
          time: 4.75,
          H: vad(100, 50, 40),
          P: vad(3.640350877192982, 2.120344721452754, 1.5902585410895655),
          Y: vad(5, 4, 3),
          finalMaxVelocity: 134.86809373244813,
          maxMotorVelocity: 250,
        },
        {
          id: 9,
          type: 8,
          time: 4.75,
          H: vad(78.12200132749251, 33.90581717451523, 30.13850415512465),
          P: vad(2.662970661194424, 1.3296398891966752, 0.8864265927977835),
          Y: vad(1.7863750261554885, 0.7091412742382273, 0.7091412742382273),
          finalMaxVelocity: 79.08017513926346,
          maxMotorVelocity: 200,
        },
      ],
    );
  });

  it("throws when max motor velocity is not positive", () => {
    expect(() =>
      planInitialTransition([
        {
          type: 1,
          ...fromTriples([0, 0, 0], [10, 0, 0], [10, 1, 1], [5, 1, 1], [5, 1, 1], 0),
        },
      ]),
    ).toThrow(/max motor velocity/i);
  });

  it("throws when a moving axis has non-positive V/A/D", () => {
    expect(() =>
      planInitialTransition([
        {
          type: 1,
          ...fromTriples([0, 0, 0], [10, 0, 0], [0, 1, 1], [5, 1, 1], [5, 1, 1], 100),
        },
      ]),
    ).toThrow(/must be greater than 0/i);
  });
});

const expectLengths = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(actual[index]).toBeCloseTo(value, 9);
  }
};

describe("two-point / four-point forward (cubic offset, origins)", () => {
  it("matches Python two-point upper and lower cable lengths", () => {
    expectLengths(
      solveTwoPointForward({
        height: 200,
        pitch: 10,
        baseHeight1: 80,
        baseHeight2: 0,
        lengthInside: 1000,
        maxHeight: 800,
      }),
      [113.29946777933216, 286.9175705553366],
    );
    expectLengths(
      solveTwoPointForward({
        height: 200,
        pitch: 10,
        baseHeight1: 0,
        baseHeight2: 120,
        lengthInside: 1000,
        maxHeight: 800,
      }),
      [286.76992655488937, 113.1463193919833],
    );
  });

  it("matches Python four-point X/Y/hold and lower-origin lengths", () => {
    expectLengths(
      solveFourPointForward({
        height: 200,
        pitch: 10,
        yaw: 0,
        baseHeight1: 80,
        baseHeight2: 0,
        lengthInside: 1000,
        widthInside: 800,
        maxHeight: 800,
        moveWhat: 1,
      }),
      [113.29946777933216, 286.9175705553366, 286.9175705553366, 113.29946777933216],
    );
    expectLengths(
      solveFourPointForward({
        height: 200,
        pitch: 0,
        yaw: 10,
        baseHeight1: 80,
        baseHeight2: 0,
        lengthInside: 1000,
        widthInside: 800,
        maxHeight: 800,
        moveWhat: 2,
      }),
      [269.52207462777795, 269.52207462777795, 130.61329387419087, 130.61329387419087],
    );
    expectLengths(
      solveFourPointForward({
        height: 200,
        pitch: 10,
        yaw: 0,
        baseHeight1: 0,
        baseHeight2: 120,
        lengthInside: 1000,
        widthInside: 800,
        maxHeight: 800,
        moveWhat: 1,
      }),
      [286.76992655488937, 113.1463193919833, 113.1463193919833, 286.76992655488937],
    );
    expectLengths(
      solveFourPointForward({
        height: 200,
        pitch: 10,
        yaw: 10,
        baseHeight1: 80,
        baseHeight2: 0,
        lengthInside: 1000,
        widthInside: 800,
        maxHeight: 800,
        moveWhat: 0,
      }),
      [200, 200, 200, 200],
    );
  });
});
