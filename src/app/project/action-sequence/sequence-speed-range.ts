import type { ControlledObjectConfig, MotorConfig } from "../project-document-types";
import { ALGORITHM_SETTINGS, buildAlgorithmModels } from "./algorithm-models";
import type { HpyPose } from "./nearest-start-motion";
import type { ResolvedActionSequence } from "./resolve-sequence";
import { calculateRangeResult } from "./speed-range";

export type SequenceSpeedRange = {
  /** 相对原动作的最大倍率，1 = 100%；null 表示无上限 */
  maxFactor: number | null;
  /** 推子能推到的最大百分比（向下取整）；null 表示无上限 */
  maxPercent: number | null;
  category: string;
};

/** 调速范围：与就近准备用同一份 models；失败抛错，调用方不沿用旧结果 */
export const evaluateSequenceSpeedRange = (input: {
  resolved: ResolvedActionSequence;
  objects: readonly ControlledObjectConfig[];
  motors: readonly MotorConfig[];
  telemetryByObjectId: ReadonlyMap<number, HpyPose>;
  forced: boolean;
}): SequenceSpeedRange => {
  const { models } = buildAlgorithmModels(input);
  if (models.length === 0) return { maxFactor: null, maxPercent: null, category: "没有运动成员" };
  const result = calculateRangeResult({
    command: { trajectory_run: input.forced },
    settings: ALGORITHM_SETTINGS,
    models,
  });
  if (result.max_factor === null) {
    return { maxFactor: null, maxPercent: null, category: result.action_category };
  }
  return {
    maxFactor: result.max_factor,
    // 吸收 0.29*100=28.999… 这类表示误差，仍按不超过最大倍率取整
    maxPercent: Math.floor(result.max_factor * 100 + 1e-9),
    category: result.action_category,
  };
};
