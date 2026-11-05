import { describe, expect, it } from "vitest";
import type {
  ControlledObject,
  ControlType,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import { planAutoBind } from "./binding-utils";

const object = (id: number, controlType: ControlType, axisCount: number): ControlledObject =>
  ({
    id,
    controlType,
    axes: Array.from({ length: axisCount }, (_, index) => ({
      key: String(index),
      custom: false,
      mount: { x: 0, z: 0 },
    })),
  }) as ControlledObject;

const motor = (
  id: number,
  plcId: number,
  busNo: 0 | 1,
  patch: Partial<Motor> = {},
): Motor => ({
  id,
  productModel: "M",
  plcId,
  busNo,
  axisType: 0,
  nodeAddress: null,
  selected: true,
  controlledObjectId: null,
  axisKey: null,
  params: {},
  ...patch,
});

describe("planAutoBind", () => {
  it("按物体和吊点顺序分配空闲电机", () => {
    const plan = planAutoBind(
      [object(1, "singlePointMove", 2), object(2, "singlePointMove", 1)],
      [motor(10, 9, 0), motor(11, 9, 0), motor(12, 9, 0)],
    );
    expect(plan.unplacedAxisCount).toBe(0);
    expect(plan.assignments).toEqual([
      { objectId: 1, axisKey: "0", motorId: 10 },
      { objectId: 1, axisKey: "1", motorId: 11 },
      { objectId: 2, axisKey: "0", motorId: 12 },
    ]);
  });

  it("同一物体的电机都在同一个从站口", () => {
    const plan = planAutoBind(
      [object(1, "dualTiltFourPointSwing", 4)],
      [motor(10, 9, 0), motor(11, 9, 1), motor(12, 9, 1), motor(13, 9, 1), motor(14, 9, 1)],
    );
    expect(plan.assignments.map((item) => item.motorId)).toEqual([11, 12, 13, 14]);
    expect(plan.unplacedAxisCount).toBe(0);
  });

  it("没有放得下的口时选空闲电机最多的口，并报告没分配到的吊点", () => {
    const plan = planAutoBind(
      [object(1, "dualTiltFourPointSwing", 4)],
      [motor(10, 9, 0), motor(11, 9, 1), motor(12, 9, 1)],
    );
    expect(plan.assignments.map((item) => item.motorId)).toEqual([11, 12]);
    expect(plan.unplacedAxisCount).toBe(2);
  });

  it("已有绑定的物体沿用它的主控和口，只补未绑定的吊点", () => {
    const plan = planAutoBind(
      [object(1, "singlePointMove", 2)],
      [
        motor(10, 9, 1, { controlledObjectId: 1, axisKey: "0" }),
        motor(11, 9, 0),
        motor(12, 8, 1),
        motor(13, 9, 1),
      ],
    );
    expect(plan.assignments).toEqual([{ objectId: 1, axisKey: "1", motorId: 13 }]);
  });

  it("已有绑定的口没有空闲电机时不跨口分配", () => {
    const plan = planAutoBind(
      [object(1, "singlePointMove", 2)],
      [motor(10, 9, 1, { controlledObjectId: 1, axisKey: "0" }), motor(11, 9, 0)],
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.unplacedAxisCount).toBe(1);
  });

  it("跳过无驱动轴的物体、已绑定的电机和未启用的电机", () => {
    const plan = planAutoBind(
      [object(1, "staticProp", 0), object(2, "singlePointMove", 1)],
      [
        motor(10, 9, 0, { selected: false }),
        motor(11, 9, 0, { controlledObjectId: 7, axisKey: "0" }),
        motor(12, 9, 0),
      ],
    );
    expect(plan.assignments).toEqual([{ objectId: 2, axisKey: "0", motorId: 12 }]);
  });

  it("没有空闲电机时不分配", () => {
    const plan = planAutoBind([object(1, "singlePointMove", 1)], []);
    expect(plan).toEqual({ assignments: [], unplacedAxisCount: 1 });
  });
});
