import type { PivotChangePayload, TransformEndPayload } from "@/app/viz3d";
import { mVec3ToMm } from "@/app/project/length-units";
import { objectRotationRadToDeg } from "@/app/project/object-rotation";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";

export type UpdateObjectFn = (id: number, patch: Partial<ControlledObject>) => void;

export type UpdateObjectsBatchFn = (
  updates: Array<{ id: number; patch: Partial<ControlledObject> }>,
) => void;

export type ResolveControlTypeFn = (id: number) => ControlledObject["controlType"] | undefined;

const patchFromPayload = (
  payload: TransformEndPayload,
  resolveControlType?: ResolveControlTypeFn,
): Partial<ControlledObject> => ({
  position: mVec3ToMm(payload.position),
  rotation: objectRotationRadToDeg(payload.rotation, resolveControlType?.(Number(payload.id))),
});

export const persistTransformPayloads = (
  updateObject: UpdateObjectFn,
  payloads: TransformEndPayload[],
  resolveControlType?: ResolveControlTypeFn,
): void => {
  payloads.forEach((payload) => {
    updateObject(Number(payload.id), patchFromPayload(payload, resolveControlType));
  });
};

/** 多选变换一次写入，避免逐个 update 触发 Viz3DObjectSync 用旧位置覆盖其它物体 */
export const persistTransformPayloadsBatch = (
  updateObjectsBatch: UpdateObjectsBatchFn,
  payloads: TransformEndPayload[],
  resolveControlType?: ResolveControlTypeFn,
): void => {
  if (payloads.length === 0) {
    return;
  }
  updateObjectsBatch(
    payloads.map((payload) => ({
      id: Number(payload.id),
      patch: patchFromPayload(payload, resolveControlType),
    })),
  );
};

export const persistPivotChanges = (
  updateObject: UpdateObjectFn,
  payloads: PivotChangePayload[],
): void => {
  payloads.forEach(({ id, position, centerOffset }) => {
    updateObject(Number(id), {
      position: mVec3ToMm(position),
      centerOffset: mVec3ToMm(centerOffset),
    });
  });
};
