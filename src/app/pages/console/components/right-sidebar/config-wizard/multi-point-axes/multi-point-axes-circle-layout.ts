import type { AxisMount } from "../config-wizard-types";

export const CIRCLE_CHORD_ERROR_WARN_MM = 1;

export type CircleChordSegment = {
  measured: number;
  compensated: number;
  error: number;
};

export type CircleMountLayoutSuccess = {
  ok: true;
  mounts: AxisMount[];
  segments: CircleChordSegment[];
};

export type CircleMountLayoutFailure = {
  ok: false;
  code:
    | "invalid-radius"
    | "incomplete-chords"
    | "invalid-chord"
    | "chord-exceeds-diameter"
    | "degenerate-angles";
  message: string;
};

export type CircleMountLayoutResult =
  | CircleMountLayoutSuccess
  | CircleMountLayoutFailure;

const polarPoint = (radius: number, angleRad: number): AxisMount => ({
  x: radius * Math.sin(angleRad),
  z: radius * Math.cos(angleRad),
});

export const averageMountRadius = (mounts: readonly AxisMount[]): number => {
  if (mounts.length === 0) return 0;
  const sum = mounts.reduce(
    (total, mount) => total + Math.hypot(mount.x, mount.z),
    0,
  );
  return sum / mounts.length;
};

export type ResolveCircleMountLayoutOptions = {
  /** 吊1 起点方位角，deg；0 = +Z（下方），与画布极角一致 */
  mountRotation?: number;
};

export const resolveCircleMountLayout = (
  radius: number | null | undefined,
  chordLengths: ReadonlyArray<number | null | undefined>,
  options: ResolveCircleMountLayoutOptions = {},
): CircleMountLayoutResult => {
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
    return {
      ok: false,
      code: "invalid-radius",
      message: "吊点半径必须为正数",
    };
  }

  if (chordLengths.length < 1) {
    return {
      ok: false,
      code: "incomplete-chords",
      message: "请填完所有相邻距离",
    };
  }

  const measured: number[] = [];
  for (const chord of chordLengths) {
    if (typeof chord !== "number" || !Number.isFinite(chord)) {
      return {
        ok: false,
        code: "incomplete-chords",
        message: "请填完所有相邻距离",
      };
    }
    if (chord <= 0) {
      return {
        ok: false,
        code: "invalid-chord",
        message: "相邻距离必须为正数",
      };
    }
    if (chord > radius * 2) {
      return {
        ok: false,
        code: "chord-exceeds-diameter",
        message: "相邻距离不能超过直径",
      };
    }
    measured.push(chord);
  }

  const angles = measured.map((chord) => 2 * Math.asin(chord / (2 * radius)));
  const angleSum = angles.reduce((sum, angle) => sum + angle, 0);
  if (!(angleSum > 0) || !Number.isFinite(angleSum)) {
    return {
      ok: false,
      code: "degenerate-angles",
      message: "相邻距离无法形成圆形布局",
    };
  }

  const scale = (2 * Math.PI) / angleSum;
  const compensatedAngles = angles.map((angle) => angle * scale);
  const segments: CircleChordSegment[] = measured.map((value, index) => {
    const compensated =
      2 * radius * Math.sin(compensatedAngles[index]! / 2);
    return {
      measured: value,
      compensated,
      error: compensated - value,
    };
  });

  const startAngle =
    typeof options.mountRotation === "number" && Number.isFinite(options.mountRotation)
      ? (options.mountRotation * Math.PI) / 180
      : 0;

  const mounts: AxisMount[] = [];
  let angle = startAngle;
  for (let index = 0; index < measured.length; index += 1) {
    mounts.push(polarPoint(radius, angle));
    angle += compensatedAngles[index]!;
  }

  return { ok: true, mounts, segments };
};

/** 绕物体原点旋转 XZ 吊点；deltaDeg 与圆形极角同向（自 +Z 转向 +X） */
export const rotateMountAroundOrigin = (
  mount: AxisMount,
  deltaDeg: number,
): AxisMount => {
  if (!Number.isFinite(deltaDeg) || deltaDeg === 0) {
    return { x: mount.x, z: mount.z };
  }
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: mount.x * cos + mount.z * sin,
    z: -mount.x * sin + mount.z * cos,
  };
};

/** 各段绝对误差之和，单位 mm */
export const totalAbsoluteChordError = (
  segments: readonly CircleChordSegment[],
): number =>
  segments.reduce((sum, segment) => sum + Math.abs(segment.error), 0);
