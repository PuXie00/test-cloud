import type { AxisMount } from "../config-wizard-types";

export type LineMountLayoutSuccess = {
  ok: true;
  mounts: AxisMount[];
};

export type LineMountLayoutFailure = {
  ok: false;
  code: "invalid-spacing" | "invalid-count";
  message: string;
};

export type LineMountLayoutResult = LineMountLayoutSuccess | LineMountLayoutFailure;

/**
 * 由逐段间距解析直线吊点：沿 Z 轴排开，首尾中点落在物体原点。
 * 共 N 个吊点，spacings 长度 = N - 1。
 */
export const resolveLineMountLayout = (
  spacings: ReadonlyArray<number | null | undefined>,
  count: number,
): LineMountLayoutResult => {
  if (count <= 0) return { ok: true, mounts: [] };
  if (count === 1) return { ok: true, mounts: [{ x: 0, z: 0 }] };

  if (spacings.length !== count - 1) {
    return {
      ok: false,
      code: "invalid-count",
      message: "相邻间距数量不匹配",
    };
  }

  const measured: number[] = [];
  for (const spacing of spacings) {
    if (typeof spacing !== "number" || !Number.isFinite(spacing) || spacing <= 0) {
      return {
        ok: false,
        code: "invalid-spacing",
        message: "相邻间距必须为正数",
      };
    }
    measured.push(spacing);
  }

  const total = measured.reduce((sum, value) => sum + value, 0);

  const mounts: AxisMount[] = [];
  let offset = -total / 2;
  for (let index = 0; index < count; index += 1) {
    mounts.push({ x: 0, z: offset === 0 ? 0 : offset });
    if (index < count - 1) offset += measured[index]!;
  }

  return { ok: true, mounts };
};
