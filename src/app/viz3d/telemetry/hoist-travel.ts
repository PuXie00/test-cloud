import type { HoistTravelAxisKind, HoistTravelDirection, Quat } from "../types";
import { mat3ToQuat } from "./mat3";
import { liftMetersOf, yawMat3Of } from "./virtual-axis-mapper";

/** 吊点调试辅助图形：线性为粗线竖直长度（米，向上为正），无极旋转为表盘指针朝向 */
export type HoistTravel =
  | { kind: "linear"; lift: number }
  | { kind: "rotary"; rotation: Quat };

/**
 * 电机位置 → 辅助图形，位置 0 为原位。正负只看电机轴方向：
 * 正向时位置增大向下 / 俯视顺时针，反向时向上 / 逆时针。
 */
export const resolveHoistTravel = (
  axisKind: HoistTravelAxisKind,
  position: number,
  direction: HoistTravelDirection,
): HoistTravel => {
  // 控制页约定：运行方向 1 为增大向下 / 顺时针，2 为反向
  const sense = direction === "reverse" ? 2 : 1;
  return axisKind === "rotary"
    ? { kind: "rotary", rotation: mat3ToQuat(yawMat3Of(sense, position)) }
    : { kind: "linear", lift: liftMetersOf(sense, position) };
};
