import { toast } from "sonner";
import { isCppAckFailed } from "@shared/csocket/ack";
import { DIMENSION_KEY_TO_VIRTUAL_AXIS } from "@/app/project/manual-jog";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { buildMoveTargetItem, type MoveTargetItem } from "./go-ready";

const AXIS_TO_TYPE: Record<VirtualAxisId, 0 | 1 | 2> = {
  v1: 0,
  v2: 1,
  v3: 2,
};

export type JogMotionParams = {
  velocity: number;
  acceleration: number;
  deceleration: number;
};

export type JogModelItem = {
  deviceId: number;
  virtualAxisType: number;
  direction: number;
  velocity: number;
  acceleration: number;
  deceleration: number;
};

export const virtualAxisTypeFromDimKey = (dimKey: string): 0 | 1 | 2 | undefined => {
  const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dimKey];
  return axis ? AXIS_TO_TYPE[axis] : undefined;
};

export const toModelJogDirection = (dir: 1 | -1 | 0): 0 | 1 | 2 => {
  if (dir === 1) return 1;
  if (dir === -1) return 2;
  return 0;
};

export const jogMotionParams = (
  useDefault: boolean,
  velocity: number,
  accelDecelTime: number,
): JogMotionParams => {
  if (useDefault) return { velocity: 0, acceleration: 0, deceleration: 0 };
  if (!Number.isFinite(velocity) || !Number.isFinite(accelDecelTime) || accelDecelTime <= 0) {
    return { velocity, acceleration: 0, deceleration: 0 };
  }
  const accel = Math.round((velocity / accelDecelTime) * 10) / 10;
  return { velocity, acceleration: accel, deceleration: accel };
};

export const buildEnableItems = (deviceIds: readonly number[], enableFlag: 0 | 1) =>
  deviceIds.map((deviceId) => ({ deviceId, enableFlag }));

export const buildResetItems = (deviceIds: readonly number[]) =>
  deviceIds.map((deviceId) => ({ deviceId }));

export const buildHomeMoveTargetItems = (deviceIds: readonly number[]): MoveTargetItem[] =>
  deviceIds.map((deviceId) =>
    buildMoveTargetItem({ objectId: String(deviceId), target: {}, current: {} }),
  );

export const buildJogModelItems = (args: {
  deviceIds: readonly number[];
  dimKey: string;
  dir: 1 | -1 | 0;
  useDefaultSpeed: boolean;
  velocity: number;
  accelDecelTime: number;
}): JogModelItem[] => {
  const virtualAxisType = virtualAxisTypeFromDimKey(args.dimKey);
  if (virtualAxisType === undefined) return [];
  const direction = toModelJogDirection(args.dir);
  const motion = jogMotionParams(args.useDefaultSpeed, args.velocity, args.accelDecelTime);
  return args.deviceIds.map((deviceId) => ({
    deviceId,
    virtualAxisType,
    direction,
    ...motion,
  }));
};

const DISCONNECTED = "C++ 未连接";

export const sendEnableModel = async (
  deviceIds: readonly number[],
  enableFlag: 0 | 1,
): Promise<void> => {
  const items = buildEnableItems(deviceIds, enableFlag);
  if (items.length === 0) return;
  const api = window.csocketApi;
  if (!api?.enableModel) {
    toast.error(DISCONNECTED);
    return;
  }
  const result = await api.enableModel(items);
  if (isCppAckFailed(result)) {
    toast.error(String(result.message || (enableFlag === 1 ? "使能指令失败" : "断能指令失败")));
  }
};

export const sendResetModel = async (deviceIds: readonly number[]): Promise<void> => {
  const items = buildResetItems(deviceIds);
  if (items.length === 0) return;
  const api = window.csocketApi;
  if (!api?.resetModel) {
    toast.error(DISCONNECTED);
    return;
  }
  const result = await api.resetModel(items);
  if (isCppAckFailed(result)) {
    toast.error(String(result.message || "复位指令失败"));
  }
};

export const sendHomeModel = async (deviceIds: readonly number[]): Promise<void> => {
  const items = buildHomeMoveTargetItems(deviceIds);
  if (items.length === 0) return;
  const api = window.csocketApi;
  if (!api?.moveTargetModel) {
    toast.error(DISCONNECTED);
    return;
  }
  const result = await api.moveTargetModel(items);
  if (isCppAckFailed(result)) {
    toast.error(String(result.message || "回原指令失败"));
  }
};

export const sendJogModel = async (items: readonly JogModelItem[]): Promise<void> => {
  if (items.length === 0) return;
  const api = window.csocketApi;
  const result = await api.jogModel([...items]);
  if (isCppAckFailed(result)) {
    toast.error(String(result.message || "点动指令失败"));
  }
};
