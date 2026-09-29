import { describe, expect, it } from "vitest";
import { toSyncMovePrepareItems, toSyncMoveStartPlan } from "@shared/csocket/sync-move-start-plan";

const zeroAxis = { pos: 0, vel: 0, accVel: 0, decVel: 0 };

describe("toSyncMoveStartPlan", () => {
  it("maps a forward non-forced plan onto v1 v2 v3 and fills missing axes with zeros", () => {
    const plan = toSyncMoveStartPlan({
      nearest: false,
      direction: 1,
      startMode: "boundary",
      targetFrameMs: 0,
      transitionSec: 1.632993162,
      xSafe: null,
      motorLimitScale: null,
      members: [
        {
          objectId: 2,
          axes: [
            {
              axis: "v1",
              from: 1100,
              to: 1000,
              velocity: 122.47,
              acceleration: 150,
              deceleration: 140,
              durationSec: 1.63,
            },
            {
              axis: "v3",
              from: -1,
              to: 0.5,
              velocity: 1.2,
              acceleration: 1.5,
              deceleration: 1.4,
              durationSec: 1.63,
            },
          ],
        },
      ],
    });

    expect(plan).toEqual({
      direction: true,
      nearest: false,
      startMode: "boundary",
      targetFrameMs: 0,
      transitionSec: 1633,
      xSafe: null,
      motorLimitScale: null,
      modelList: [
        {
          deviceId: 2,
          virtualAxis: [
            { pos: 1000, vel: 122.5, accVel: 150, decVel: 140 },
            zeroAxis,
            { pos: 0.5, vel: 1.2, accVel: 1.5, decVel: 1.4 },
          ],
        },
      ],
    });
  });

  it("encodes reverse as direction false and keeps every member", () => {
    const plan = toSyncMoveStartPlan({
      nearest: true,
      direction: -1,
      startMode: "nearest",
      targetFrameMs: 4000,
      transitionSec: 2.5,
      xSafe: null,
      motorLimitScale: 1,
      members: [
        { objectId: 7, axes: [] },
        {
          objectId: 8,
          axes: [
            {
              axis: "v2",
              from: 2,
              to: 0.4,
              velocity: 2,
              acceleration: 0.7,
              deceleration: 0.7,
              durationSec: 2,
            },
          ],
        },
      ],
    });

    expect(plan.direction).toBe(false);
    expect(plan.nearest).toBe(true);
    expect(plan.startMode).toBe("nearest");
    expect(plan.targetFrameMs).toBe(4000);
    expect(plan.transitionSec).toBe(2500);
    expect(plan.xSafe).toBeNull();
    expect(plan.motorLimitScale).toBe(1);
    expect(plan.modelList).toEqual([
      { deviceId: 7, virtualAxis: [zeroAxis, zeroAxis, zeroAxis] },
      {
        deviceId: 8,
        virtualAxis: [
          zeroAxis,
          { pos: 0.4, vel: 2, accVel: 0.7, decVel: 0.7 },
          zeroAxis,
        ],
      },
    ]);
  });
});

describe("toSyncMovePrepareItems", () => {
  it("attaches the converted plan and leaves items without a plan unchanged", () => {
    const modelList = [{ deviceId: 1 }];
    const IOBlockList = [{ time: 0 }];
    const items = toSyncMovePrepareItems([
      {
        actionId: 4,
        modelList,
        IOBlockList,
        startPlan: {
          nearest: true,
          direction: 1,
          startMode: "nearest",
          targetFrameMs: 1040,
          transitionSec: 4.4,
          xSafe: true,
          motorLimitScale: null,
          members: [
            {
              objectId: 1,
              axes: [
                {
                  axis: "v1",
                  from: 120,
                  to: 100,
                  velocity: 50,
                  acceleration: 25,
                  deceleration: 25,
                  durationSec: 1.7,
                },
              ],
            },
          ],
        },
      },
      { actionId: 5, modelList, IOBlockList },
    ]);

    expect(items[0]).toEqual({
      actionId: 4,
      modelList,
      IOBlockList,
      startPlan: {
        direction: true,
        nearest: true,
        startMode: "nearest",
        targetFrameMs: 1040,
        transitionSec: 4400,
        xSafe: true,
        motorLimitScale: null,
        modelList: [
          {
            deviceId: 1,
            virtualAxis: [
              { pos: 100, vel: 50, accVel: 25, decVel: 25 },
              zeroAxis,
              zeroAxis,
            ],
          },
        ],
      },
    });
    expect(items[1]).toEqual({ actionId: 5, modelList, IOBlockList });
    expect(items[1]).not.toHaveProperty("startPlan");
  });

  it("sends an empty at-start plan with the boundary frame", () => {
    const [item] = toSyncMovePrepareItems([
      {
        actionId: 6,
        modelList: [],
        IOBlockList: [],
        startPlan: {
          nearest: false,
          direction: -1,
          startMode: "at-start",
          targetFrameMs: 16000,
          transitionSec: 0,
          xSafe: null,
          motorLimitScale: null,
          members: [],
        },
      },
    ]);
    expect(item?.startPlan).toEqual({
      direction: false,
      nearest: false,
      startMode: "at-start",
      targetFrameMs: 16000,
      transitionSec: 0,
      xSafe: null,
      motorLimitScale: null,
      modelList: [],
    });
  });
});
