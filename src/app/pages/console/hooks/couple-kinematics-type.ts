import type { ControlType } from "@/app/project/configuration-types";

/** Python sidecar type codes from YXZ_2819: 31 单点 / 32 两点 / 64 四点 / 63 多点. */
export type SolverTypeCode = 31 | 32 | 64 | 63;

const SOLVER_TYPE_BY_CONTROL: Partial<Record<ControlType, SolverTypeCode>> = {
  singlePointMove: 31,
  twoPointSwing: 32,
  fourPointSwing: 64,
  dualTiltFourPointSwing: 64,
  multiPointSwing: 63,
};

export const encodeSolverType = (controlType: ControlType): SolverTypeCode | null =>
  SOLVER_TYPE_BY_CONTROL[controlType] ?? null;
