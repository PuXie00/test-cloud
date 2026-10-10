import {
  canMountTo,
  remountPose,
  resolveMountParentId,
  topmostMountIds,
  type MountPose,
} from "@/app/project/object-mount";
import { normalizeObjectRotationDeg } from "@/app/project/object-rotation";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";

/** 写入挂载结果：parentId 为 null 时去掉该字段；带 v2/v3 的类型只保留 Y 旋转 */
export const withMountPose = (
  object: ControlledObject,
  parentId: number | null,
  pose: MountPose,
): ControlledObject => {
  const { parentId: _previous, ...rest } = object;
  return {
    ...rest,
    ...(parentId != null ? { parentId } : {}),
    position: pose.position,
    rotation: normalizeObjectRotationDeg(pose.rotation, object.controlType),
  };
};

/**
 * 把 objectIds 挂到 parentId（null = 解除挂载），保持世界位置。
 * 挂载时只处理选中集合里最上层的物体（其余随父物体走）；不合法的挂载跳过。
 * 无变化时返回原数组。
 */
export const applyObjectMount = (
  objects: readonly ControlledObject[],
  objectIds: readonly number[],
  parentId: number | null,
): readonly ControlledObject[] => {
  const targets = parentId == null ? objectIds : topmostMountIds(objects, objectIds);
  let next = objects;
  for (const id of targets) {
    const current = next.find((object) => object.id === id);
    if (!current || (current.parentId ?? null) === parentId) continue;
    if (parentId != null && !canMountTo(next, id, parentId)) continue;
    const pose = remountPose(next, id, parentId);
    if (!pose) continue;
    next = next.map((object) => (object.id === id ? withMountPose(object, parentId, pose) : object));
  }
  return next;
};

/**
 * 物体树拖放的目标父物体：inside → 挂到目标物体；before / after → 与目标同级
 * （挂到目标的父物体，目标在根层即解除挂载）。不合法或无变化时返回 undefined。
 */
export const resolveMountDropParent = (
  objects: readonly ControlledObject[],
  dragIds: readonly number[],
  targetId: number,
  position: "before" | "inside" | "after",
): number | null | undefined => {
  const parentId = position === "inside" ? targetId : resolveMountParentId(objects, targetId);
  const moving = parentId == null ? dragIds : topmostMountIds(objects, dragIds);
  if (moving.length === 0) return undefined;
  if (parentId != null && !moving.every((id) => canMountTo(objects, id, parentId))) {
    return undefined;
  }
  const changed = moving.some(
    (id) => (objects.find((object) => object.id === id)?.parentId ?? null) !== parentId,
  );
  return changed ? parentId : undefined;
};
