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

export type ResolveLineMountLayoutOptions = {
  /** 直线方向方位角，deg；0 = +Z，与画布极角一致 */
  mountRotation?: number;
};

const directionUnit = (angleRad: number): { sin: number; cos: number } => ({
  sin: Math.sin(angleRad),
  cos: Math.cos(angleRad),
});

/**
 * 由逐段间距解析直线吊点：首尾中点落在物体原点，向两侧展开。
 * 共 N 个吊点，spacings 长度 = N - 1。
 */
export const resolveLineMountLayout = (
  spacings: ReadonlyArray<number | null | undefined>,
  count: number,
  options: ResolveLineMountLayoutOptions = {},
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
  const startAngle =
    typeof options.mountRotation === "number" && Number.isFinite(options.mountRotation)
      ? (options.mountRotation * Math.PI) / 180
      : 0;
  const { sin, cos } = directionUnit(startAngle);

  const mounts: AxisMount[] = [];
  let offset = -total / 2;
  for (let index = 0; index < count; index += 1) {
    const x = sin * offset;
    const z = cos * offset;
    mounts.push({ x: x === 0 ? 0 : x, z: z === 0 ? 0 : z });
    if (index < count - 1) offset += measured[index]!;
  }

  return { ok: true, mounts };
};
