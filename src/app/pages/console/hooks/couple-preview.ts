export const COUPLE_DEVIATION_BLOCK_MM = 500;

export type CouplePreviewInputRow = {
  objectId: number;
  objectName: string;
  motorId: number;
  currentMm: number;
  targetMm: number;
};

export type CouplePreviewRow = CouplePreviewInputRow & {
  deviationMm: number;
  highlight: boolean;
};

export type CouplePreviewFooter = "none" | "motion-warning" | "deviation-blocked";

export const COUPLE_MOTION_WARNING = "注意:确定耦合之后，机械可能会出现运动!!";
export const COUPLE_DEVIATION_BLOCKED = "【偏转过大，超500】";

export type CouplePreviewResult = {
  rows: CouplePreviewRow[];
  footer: CouplePreviewFooter;
  confirmEnabled: boolean;
  timedOut: boolean;
};

export const COUPLE_SOLVE_TIMEOUT = "耦合计算超时";
export const COUPLE_SOLVE_TIMEOUT_HINT = "建议少量物体耦合";

export const roundCoupleMm = (value: number): number => Math.round(value);

export const classifyCouplePreview = (
  inputs: readonly CouplePreviewInputRow[],
  options?: { timedOut?: boolean },
): CouplePreviewResult => {
  const timedOut = options?.timedOut === true;
  const rows: CouplePreviewRow[] = inputs.map((input) => {
    const deviationMm = roundCoupleMm(input.targetMm) - roundCoupleMm(input.currentMm);
    return {
      ...input,
      currentMm: roundCoupleMm(input.currentMm),
      targetMm: roundCoupleMm(input.targetMm),
      deviationMm,
      highlight: Math.abs(deviationMm) >= 1,
    };
  });
  const hasNonZero = rows.some((row) => row.highlight);
  const blocked = rows.some((row) => Math.abs(row.deviationMm) > COUPLE_DEVIATION_BLOCK_MM);
  if (blocked && !timedOut) {
    return { rows, footer: "deviation-blocked", confirmEnabled: false, timedOut };
  }
  if (hasNonZero) {
    return { rows, footer: "motion-warning", confirmEnabled: true, timedOut };
  }
  return { rows, footer: "none", confirmEnabled: true, timedOut };
};
