import { describe, expect, it } from "vitest";
import {
  classifyCouplePreview,
  type CouplePreviewInputRow,
} from "./couple-preview";

const row = (
  currentMm: number,
  targetMm: number,
): CouplePreviewInputRow => ({
  objectId: 1,
  objectName: "A",
  motorId: 10,
  currentMm,
  targetMm,
});

describe("classifyCouplePreview", () => {
  it("allows confirm with no hint when every rounded deviation is 0", () => {
    const result = classifyCouplePreview([row(100.4, 100.4), row(0.4, 0.2)]);
    expect(result.footer).toBe("none");
    expect(result.confirmEnabled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.rows.every((item) => !item.highlight)).toBe(true);
  });

  it("highlights nonzero rows, shows motion warning, and allows confirm when all |dev| <= 500", () => {
    const result = classifyCouplePreview([row(100, 100), row(0, 12)]);
    expect(result.footer).toBe("motion-warning");
    expect(result.confirmEnabled).toBe(true);
    expect(result.rows.map((item) => item.highlight)).toEqual([false, true]);
    expect(result.rows[1]?.deviationMm).toBe(12);
  });

  it("blocks confirm and shows oversize copy when any |dev| > 500", () => {
    const result = classifyCouplePreview([row(0, 12), row(0, 501)]);
    expect(result.footer).toBe("deviation-blocked");
    expect(result.confirmEnabled).toBe(false);
    expect(result.rows.every((item) => item.highlight)).toBe(true);
  });

  it("timeout keeps confirm enabled and does not apply 500mm block", () => {
    const result = classifyCouplePreview([row(0, 12), row(0, 501)], { timedOut: true });
    expect(result.timedOut).toBe(true);
    expect(result.confirmEnabled).toBe(true);
    expect(result.footer).toBe("motion-warning");
  });
});
