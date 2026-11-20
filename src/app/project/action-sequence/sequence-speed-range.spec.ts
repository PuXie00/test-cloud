import { describe, expect, it } from "vitest";
import { fixtureObjects, fixtureSequence } from "./nearest-start.fixture";
import { resolveActionSequence } from "./resolve-sequence";
import { evaluateSequenceSpeedRange } from "./sequence-speed-range";

/**
 * 期望值由 python/调速范围计算/调速范围计算.py（2026-11-19 四模型版）对
 * buildAlgorithmModels + withAlgorithmModelType 的输出计算得到（多点倾斜 → 9，多点摆 → 7）。
 */
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
    // 多点摆 Y 峰速 3.9°/s，超过默认最大 3°/s：整条动作只能 76%
    expect(rangeOf(forced)).toMatchObject({ maxFactor: 0.768, maxPercent: 76 });
    // 多点倾斜：P 峰速 2.22°/s 按速度可到 135%，但加速度随倍率平方增长，
    // √(最大 3°/s² ÷ 峰值 2.47°/s²) → 110%
    expect(rangeOf(forced, 3)).toMatchObject({ maxFactor: 1.10227038425243, maxPercent: 110 });
  });

  it("caps by the acceleration capability when it is the tighter one", () => {
    // 单点：电机 380 → 212.8%，H 最大速度 500 → 280%；H 加速度 √(500 ÷ 255.1) → 140%
    expect(rangeOf(true, 1)).toMatchObject({ maxFactor: 1.4000000000000001, maxPercent: 140 });
    expect(rangeOf(false, 1)).toMatchObject({ category: "全部单点/多级升降：可升速、可降速" });
  });
});
