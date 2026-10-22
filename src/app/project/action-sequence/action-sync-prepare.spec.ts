import { describe, expect, it } from "vitest";
import {
  toActionPrepareDevices,
  toActionSyncPrepareHead,
  toActionSyncPrepareParams,
  type ActionGoItem,
} from "@shared/csocket/action-sync-prepare";

const zeroDevice = (deviceId: number) => ({
  deviceId,
  velocityH: 0,
  accelerationH: 0,
  velocityP: 0,
  accelerationP: 0,
  velocityY: 0,
  accelerationY: 0,
});

const item: ActionGoItem = {
  actionId: 12,
  runDirection: 2,
  speedScale: 0.73,
  loopCount: 1,
  trajectoryMode: true,
  deviceId: [1, 2, 3],
  selectedCurveTimeMs: 8000,
  prepareTimeMs: 4293,
  prepareDevices: [
    { ...zeroDevice(2), velocityH: 147.06, accelerationH: 1922.5, velocityP: 2.8, accelerationP: 435.5 },
  ],
};

describe("toActionSyncPrepareHead", () => {
  it("carries the selected frame and prepare time from the nearest plan in protocol order", () => {
    const head = toActionSyncPrepareHead(item);
    expect(head).toEqual({
      actionId: 12,
      runDirection: 2,
      speedScale: 73,
      loopCount: 1,
      selectedCurveTimeMs: 8000,
      deviceCount: 3,
      prepareTimeMs: 4293,
    });
    expect(Object.keys(head)).toEqual([
      "actionId",
      "runDirection",
      "speedScale",
      "loopCount",
      "selectedCurveTimeMs",
      "deviceCount",
      "prepareTimeMs",
    ]);
  });

  it("sends the fader speed as-is above 100%", () => {
    expect(toActionSyncPrepareHead({ ...item, speedScale: 1.5 }).speedScale).toBe(150);
  });

  it("falls back to forward, frame 0 and no prepare time", () => {
    const { prepareTimeMs: _, selectedCurveTimeMs: __, ...rest } = item;
    expect(toActionSyncPrepareHead({ ...rest, runDirection: 0 })).toMatchObject({
      runDirection: 1,
      selectedCurveTimeMs: 0,
      prepareTimeMs: 0,
    });
  });
});

describe("toActionSyncPrepareParams", () => {
  it("lists every device in deviceId order and zeroes the ones without a move", () => {
    expect(toActionSyncPrepareParams(item)).toEqual([zeroDevice(1), item.prepareDevices![0], zeroDevice(3)]);
  });
});

describe("toActionPrepareDevices", () => {
  it("fills the V/A of each moving axis and zeroes the rest", () => {
    const devices = toActionPrepareDevices(
      {
        members: [
          {
            objectId: 4,
            axes: [
              { axis: "v1", to: 1000, velocity: 97.98, acceleration: 120, deceleration: 120 },
              { axis: "v3", to: 0, velocity: 1.22, acceleration: 1.5, deceleration: 1.5 },
            ],
          },
          { objectId: 5, axes: [] },
        ],
      },
      [4, 5, 6],
    );
    expect(devices).toEqual([
      { ...zeroDevice(4), velocityH: 97.98, accelerationH: 120, velocityY: 1.22, accelerationY: 1.5 },
      zeroDevice(5),
      zeroDevice(6),
    ]);
  });
});
