import type { ModelPose } from "../action-sequence/types";
import type { SceneObjectConfig } from "@/app/viz3d/types";
import { DEG_TO_RAD, MM_TO_M } from "@/app/viz3d/telemetry/virtual-axis-mapper";

/**
 * 仅用于一个已解析区间：每个虚轴在它自己的梯形曲线上单调（经过速度也沿行进方向）。
 * 两端轴值因此界住中间全部轴值。角度用原始轴值差，整圈旋转也保留扫过的弧长。
 * radius 是该坐标系中所有待测点（可含挂载后代）到枢轴原点的距离上界。
 */
export const localTravelBound = (
  config: SceneObjectConfig, a: ModelPose, b: ModelPose, radius: number,
): number => {
  const k = config.kinematics;
  if (!k) return 0;
  const dh = Math.abs(a.v1 - b.v1);
  const dx = Math.abs(a.v2 - b.v2);
  const dz = Math.abs(a.v3 - b.v3);
  switch (k.controlType) {
    case "staticProp":
    case "railCar":
      return 0;
    case "singlePointMove":
    case "multiLevelHoist":
      return dh * MM_TO_M;
    case "continuousRotation":
    case "singlePointRotation":
      return dh * DEG_TO_RAD * radius;
    case "dualTiltFourPointSwing":
    case "multiPointSwing": {
      if (dh === 0 && dx === 0 && dz === 0) return 0;
      // 挂点半径同时界住半跨度、挂点中心在水平面的偏心距。
      const mounts = config.hoistAxes ?? [];
      const reach = mounts.reduce((r, axis) => Math.max(r, Math.hypot(axis.mount.x, axis.mount.z)), 0);
      const halfHeight = Math.abs(config.dimensions.h) / 2;
      if (k.controlType === "dualTiltFourPointSwing") {
        const pivot = Math.hypot(reach, halfHeight);
        const shift = (x: number) => (x / 90) ** 3;
        const slide = reach * (Math.abs(shift(a.v2) - shift(b.v2)) + Math.abs(shift(a.v3) - shift(b.v3)));
        return dh * MM_TO_M + (radius + pivot) * (dx + dz) * DEG_TO_RAD + slide;
      }
      // 多点摆的 PLC 经验侧移一般不是线性函数，但始终不超过吊点边界。
      // 两姿态之间的侧移变化不超过两倍挂点半径。俯仰恒为零且正常高度时侧移恒为零。
      const minHeight = k.runDirection === 1
        ? Math.min(a.v1, b.v1) + k.pulleyDistance
        : k.pulleyDistance + k.maxHeight - Math.max(a.v1, b.v1);
      const slide = a.v2 === 0 && b.v2 === 0 && minHeight >= 0 ? 0 : 2 * reach;
      return dh * MM_TO_M + (radius + halfHeight) * (dx + 2 * dz) * DEG_TO_RAD + slide;
    }
  }
};
