import { describe, expect, it } from "vitest";
import { fixtureObjects, fixtureSequence } from "./nearest-start.fixture";
import { resolveActionSequence } from "./resolve-sequence";
import { evaluateSequenceSpeedRange } from "./sequence-speed-range";

/** 期望值由 python/调速范围计算/调速范围计算.py（2026-11-11）对 buildAlgorithmModels 的输出计算得到。 */
const rangeOf = (forced: boolean, objectId?: number) => {
  const sequence = fixtureSequence(forced);
  if (objectId !== undefined) sequence.blocks = sequence.blocks.filter((block) => block.objectId === objectId);
  return evaluateSequenceSpeedRange({
    resolved: resolveActionSequence(sequence),
    objects: fixtureObjects(),
    motors: [],
    telemetryByObjectId: new Map(),
    forced,
  });
};

describe("evaluateSequenceSpeedRange", () => {
  it.each([true, false])("caps by the swing-axis max velocity (forced %s)", (forced) => {
    // 多点 Y 峰速 3.9°/s，超过默认最大 3°/s：整条动作只能 76%
    expect(rangeOf(forced)).toMatchObject({ maxFactor: 0.768, maxPercent: 76 });
    // 四点 P/Y 峰速 2.22°/s → 135%（只看电机时为 231%）
    expect(rangeOf(forced, 3)).toMatchObject({ maxFactor: 1.3499999999999999, maxPercent: 135 });
  });

  it("keeps the motor limit when it is the tighter one", () => {
    // 单点：电机 380 → 212.8%；虚轴 H 未绑电机按 500 → 280%
    expect(rangeOf(true, 1)).toMatchObject({ maxFactor: 2.1279999999999997, maxPercent: 212 });
  });
});
