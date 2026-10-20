import { describe, expect, it } from "vitest";
import {
  autoLayoutAngleDeg,
  keepLayoutOffsets,
  layoutParticipants,
  participantOffsets,
} from "./preset-layout";

describe("preset layout", () => {
  it("picks the direction the objects spread the most along", () => {
    expect(autoLayoutAngleDeg([{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 6000, z: 10 }])).toBeCloseTo(0.1, 1);
    expect(autoLayoutAngleDeg([{ x: 0, z: 0 }, { x: 0, z: 2000 }])).toBe(90);
    expect(autoLayoutAngleDeg([{ x: 0, z: 0 }, { x: 1000, z: 1000 }])).toBe(45);
    expect(autoLayoutAngleDeg([{ x: 0, z: 1000 }, { x: 1000, z: 0 }])).toBe(-45);
    expect(autoLayoutAngleDeg([{ x: 5, z: 5 }, { x: 5, z: 5 }])).toBe(0);
  });

  it("orders by position along the direction and keeps the real spacing", () => {
    // 选择顺序是 c、a、b；沿 X 是 a(0) b(1000) c(3000)
    const result = layoutParticipants(
      [
        { id: 3, x: 3000, z: 0 },
        { id: 1, x: 0, z: 0 },
        { id: 2, x: 1000, z: 0 },
      ],
      0,
    );
    expect(result.orderedObjectIds).toEqual([1, 2, 3]);
    // 平均间距 1500：0、1000/1500、2
    expect(result.layout).toEqual({ angleDeg: 0, offsets: [0, 0.6667, 2] });
  });

  it("gives 0,1,2 for even spacing, reverses at 180° and uses the auto angle by default", () => {
    const row = [
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 0, z: 1500 },
      { id: 3, x: 0, z: 3000 },
    ];
    expect(layoutParticipants(row)).toEqual({
      orderedObjectIds: [1, 2, 3],
      layout: { angleDeg: 90, offsets: [0, 1, 2] },
    });
    expect(layoutParticipants(row, 270).orderedObjectIds).toEqual([3, 2, 1]);
    expect(layoutParticipants(row, 270).layout.angleDeg).toBe(-90);
  });

  it("keeps the given order with even spacing when nothing spreads along the direction", () => {
    const stacked = [
      { id: 2, x: 0, z: 0 },
      { id: 1, x: 0, z: 0 },
    ];
    expect(layoutParticipants(stacked, 0)).toEqual({
      orderedObjectIds: [2, 1],
      layout: { angleDeg: 0, offsets: [0, 1] },
    });
  });

  it("falls back to the participant index for presets without a layout", () => {
    expect(participantOffsets({ orderedObjectIds: [5, 6, 7] })).toEqual([0, 1, 2]);
    expect(
      participantOffsets({ orderedObjectIds: [5, 6], layout: { angleDeg: 0, offsets: [0, 1, 2] } }),
    ).toEqual([0, 1]);
  });

  it("renormalizes the offsets that are left after removing participants", () => {
    const layout = { angleDeg: 0, offsets: [0, 0.5, 1, 3] };
    expect(keepLayoutOffsets(layout, [false, true, true, true])).toEqual({
      angleDeg: 0,
      offsets: [0, 0.4, 2],
    });
  });
});
