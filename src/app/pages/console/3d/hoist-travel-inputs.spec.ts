import { describe, expect, it } from "vitest";
import { hoistTravelInputs } from "./hoist-travel-inputs";

const motor = (
  id: number,
  axisType: 0 | 1,
  controlledObjectId: number | null = 10,
  params: Record<string, number | boolean | string> = { axisDirection: 0 },
) => ({
  id,
  axisType,
  controlledObjectId,
  params,
});

const snapshot = (id: number, actualPosition: number | null, live = true) => ({
  id,
  live,
  actualPosition,
});

describe("hoistTravelInputs", () => {
  it("按电机轴类型区分线性与无极旋转，位置原样传递", () => {
    expect(
      hoistTravelInputs([motor(1, 0), motor(2, 1)], [snapshot(1, 1250.5), snapshot(2, -90)]),
    ).toEqual([
      { motorId: "1", axisKind: "linear", direction: "forward", position: 1250.5 },
      { motorId: "2", axisKind: "rotary", direction: "forward", position: -90 },
    ]);
  });

  it("轴方向 1 为反向，缺省或其他值按正向", () => {
    expect(
      hoistTravelInputs(
        [motor(1, 0, 10, { axisDirection: 1 }), motor(2, 1, 10, { axisDirection: "1" }), motor(3, 0, 10, {})],
        [snapshot(1, 5), snapshot(2, 5), snapshot(3, 5)],
      ).map((input) => input.direction),
    ).toEqual(["reverse", "reverse", "forward"]);
  });

  it("位置 0 仍显示（原位）", () => {
    expect(hoistTravelInputs([motor(1, 0)], [snapshot(1, 0)])).toEqual([
      { motorId: "1", axisKind: "linear", direction: "forward", position: 0 },
    ]);
  });

  it("跳过离线、无位置、未绑定和没有快照的电机", () => {
    expect(
      hoistTravelInputs(
        [motor(1, 0), motor(2, 0), motor(3, 0, null), motor(4, 1)],
        [snapshot(1, 100, false), snapshot(2, null), snapshot(3, 100)],
      ),
    ).toEqual([]);
  });
});
