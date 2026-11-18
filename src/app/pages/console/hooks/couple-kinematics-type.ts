import type { ControlType } from "@/app/project/configuration-types";

/** 求解器 type：2 单点 / 3 多级升降 / 7 多点摆 / 9 XY 多点摆 */
export type SolverTypeCode = 2 | 3 | 7 | 9;

const SOLVER_TYPE_BY_CONTROL: Partial<Record<ControlType, SolverTypeCode>> = {
  singlePointMove: 2,
  multiLevelHoist: 3,
  multiPointSwing: 7,
  dualTiltFourPointSwing: 9,
};

export const encodeSolverType = (controlType: ControlType): SolverTypeCode | null =>
  SOLVER_TYPE_BY_CONTROL[controlType] ?? null;
