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
      prepareTimeMs: 1633,
      loopCount: 1,
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
      targetFrameMs: 0,
      transitionSec: 1633,
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

  it("sends the algorithm's entry moves as they are and rounds the join frame to a millisecond", () => {
    const entry = (pos: number, vel: number, accVel: number, decVel: number) => ({ pos, vel, accVel, decVel });
    const plan = toSyncMoveStartPlan({
      nearest: true,
      direction: 1,
      startMode: "nearest",
      targetFrameMs: 10384.4,
      transitionSec: 0.7672,
      prepareTimeMs: 768,
      loopCount: 1,
      motorLimitScale: null,
      members: [
        {
          objectId: 3,
          axes: [
            // 带速接入：pos 是停车目标（不是接入点 to），V/A/D 原样
            { axis: "v1", to: 2052.3, velocity: 79.1, acceleration: 500, deceleration: 390.6, entryMove: entry(2200, 79.1, 500, 390.6) },
            // 原地保持的轴也下发：pos 为当前位置、vel > 0
            { axis: "v2", to: 8, velocity: 3, acceleration: 3, deceleration: 3, entryMove: entry(8, 3, 3, 3) },
            // 设备没有的轴：pos 为实时值、速度 0，不下发
            { axis: "v3", to: 0.4, velocity: 0, acceleration: 0, deceleration: 0, entryMove: entry(0.4, 0, 0, 0) },
          ],
        },
      ],
    });
    expect(plan).toEqual({
      direction: true,
      nearest: true,
      targetFrameMs: 10384,
      transitionSec: 767,
      modelList: [
        {
          deviceId: 3,
          virtualAxis: [entry(2200, 79.1, 500, 390.6), entry(8, 3, 3, 3), entry(0.4, 0, 0, 0)],
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
      prepareTimeMs: 2500,
      loopCount: 1,
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
    expect(plan.targetFrameMs).toBe(4000);
    expect(plan.transitionSec).toBe(2500);
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
          prepareTimeMs: 4400,
          loopCount: 1,
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
        targetFrameMs: 1040,
        transitionSec: 4400,
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
          prepareTimeMs: 0,
          loopCount: 1,
          motorLimitScale: null,
          members: [],
        },
      },
    ]);
    expect(item?.startPlan).toEqual({
      direction: false,
      nearest: false,
      targetFrameMs: 16000,
      transitionSec: 0,
      modelList: [],
    });
  });
});
