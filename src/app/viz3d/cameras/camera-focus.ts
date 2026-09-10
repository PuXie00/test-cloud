import type { Vec3 } from "../types";

export type FocusBounds = { min: Vec3; max: Vec3 };

export type FocusFrame = {
  target: Vec3;
  distance: number;
  orthoHalfHeight: number;
};

export type FocusFitOptions = {
  /** 垂直 FOV，弧度；正交相机忽略 */
  fov: number;
  /** 视口宽高比；缺省 1 */
  aspect?: number;
  orthographic: boolean;
  /** 相对包围球的余量，默认 1.15 */
  margin?: number;
};

export type FocusFitResult = {
  center: Vec3;
  distance: number;
  orthoHalfHeight: number;
};

export const DEFAULT_FOCUS_MARGIN = 1.15;
export const DEFAULT_FOCUS_DURATION_MS = 260;
export const MIN_FOCUS_DISTANCE = 0.1;
export const MIN_FOCUS_ORTHO_HALF = 0.5;

/** 合并多个包围盒为单一 AABB；空输入返回 null */
export const mergeFocusBounds = (bounds: readonly FocusBounds[]): FocusBounds | null => {
  if (bounds.length === 0) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const box of bounds) {
    min.x = Math.min(min.x, box.min.x);
    min.y = Math.min(min.y, box.min.y);
    min.z = Math.min(min.z, box.min.z);
    max.x = Math.max(max.x, box.max.x);
    max.y = Math.max(max.y, box.max.y);
    max.z = Math.max(max.z, box.max.z);
  }
  return { min, max };
};

/** 由包围盒计算聚焦中心与缩放距离（方向无关，用包围球半径） */
export const resolveFocusFit = (
  bounds: FocusBounds,
  options: FocusFitOptions,
): FocusFitResult => {
  const margin = options.margin ?? DEFAULT_FOCUS_MARGIN;
  const aspect = options.aspect && options.aspect > 0 ? options.aspect : 1;

  const center: Vec3 = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };

  const halfDiagonal =
    Math.hypot(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    ) / 2;
  const radius = Math.max(halfDiagonal, 0.001);

  if (options.orthographic) {
    const orthoHalfHeight = Math.max(MIN_FOCUS_ORTHO_HALF, radius * margin);
    return {
      center,
      distance: Math.max(MIN_FOCUS_DISTANCE, orthoHalfHeight * 2),
      orthoHalfHeight,
    };
  }

  const tanHalfV = Math.tan(options.fov / 2);
  if (!(tanHalfV > 0)) {
    const distance = Math.max(MIN_FOCUS_DISTANCE, radius * margin * 2);
    return {
      center,
      distance,
      orthoHalfHeight: Math.max(MIN_FOCUS_ORTHO_HALF, distance * 0.5),
    };
  }

  const halfV = options.fov / 2;
  const halfH = Math.atan(tanHalfV * aspect);
  const halfAngle = Math.min(halfV, halfH);
  const distance = Math.max(MIN_FOCUS_DISTANCE, (radius / Math.sin(halfAngle)) * margin);
  return {
    center,
    distance,
    orthoHalfHeight: Math.max(MIN_FOCUS_ORTHO_HALF, distance * 0.5),
  };
};

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** 平滑飞行插值状态机；纯计算，不接触相机 */
export class CameraFlyTo {
  private from: FocusFrame | null = null;
  private to: FocusFrame | null = null;
  private startMs = 0;
  private durationMs = 0;

  start(from: FocusFrame, to: FocusFrame, durationMs: number, startMs = performance.now()): void {
    this.from = from;
    this.to = to;
    this.startMs = startMs;
    this.durationMs = Math.max(1, durationMs);
  }

  cancel(): void {
    this.from = null;
    this.to = null;
  }

  get active(): boolean {
    return this.from !== null && this.to !== null;
  }

  sample(nowMs: number): { frame: FocusFrame; done: boolean } | null {
    if (!this.from || !this.to) return null;
    const t = Math.min(1, Math.max(0, (nowMs - this.startMs) / this.durationMs));
    const e = easeInOutCubic(t);
    const frame: FocusFrame = {
      target: {
        x: lerp(this.from.target.x, this.to.target.x, e),
        y: lerp(this.from.target.y, this.to.target.y, e),
        z: lerp(this.from.target.z, this.to.target.z, e),
      },
      distance: lerp(this.from.distance, this.to.distance, e),
      orthoHalfHeight: lerp(this.from.orthoHalfHeight, this.to.orthoHalfHeight, e),
    };
    if (t >= 1) {
      this.cancel();
      return { frame, done: true };
    }
    return { frame, done: false };
  }
}
