import type { HoistTravelAxisKind, Quat } from "../types";
import { mat3ToQuat } from "./mat3";
import { liftMetersOf, yawMat3Of } from "./virtual-axis-mapper";

/** 吊点调试辅助图形：线性为粗线竖直长度（米，向上为正），无极旋转为表盘指针朝向 */
export type HoistTravel =
  | { kind: "linear"; lift: number }
  | { kind: "rotary"; rotation: Quat };

/** 电机位置 → 辅助图形；正负与控制页虚轴 v1 一致（按物体运行方向），位置 0 为原位 */
export const resolveHoistTravel = (
  axisKind: HoistTravelAxisKind,
  position: number,
  runDirection: 1 | 2,
): HoistTravel =>
  axisKind === "rotary"
    ? { kind: "rotary", rotation: mat3ToQuat(yawMat3Of(runDirection, position)) }
    : { kind: "linear", lift: liftMetersOf(runDirection, position) };
