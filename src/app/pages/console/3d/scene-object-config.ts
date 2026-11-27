import type { SceneObjectConfig } from "@/app/viz3d/types";
import { mmDimensionsToM, mmMountToM, mmToM, mmVec3ToM } from "@/app/project/length-units";
import {
  modelRotationAxesForControlType,
  normalizeObjectRotationDeg,
  objectRotationDegToRad,
} from "@/app/project/object-rotation";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { toEngineHoleDimensions } from "../components/right-sidebar/config-wizard/config-descriptors";
import { sceneKinematicsForObject } from "./scene-kinematics";

/** 同一份安装坐标、模型尺寸及吊点运动基准用于视窗与离线碰撞校验。 */
export function sceneConfigForObject(object: ControlledObject): SceneObjectConfig {
  const hole = toEngineHoleDimensions(object.shapePreset, object.shapeDimensions);
  return {
    id: String(object.id),
    name: object.name,
    shape: object.shapePreset === "external" ? "cube" : object.shapePreset,
    dimensions: mmDimensionsToM(object.dimensions),
    holeDimensions: hole ? { w: mmToM(hole.w), d: mmToM(hole.d) } : undefined,
    position: mmVec3ToM(object.position),
    centerOffset: mmVec3ToM(object.centerOffset),
    rotation: objectRotationDegToRad(normalizeObjectRotationDeg(object.rotation, object.controlType)),
    rotationAxes: modelRotationAxesForControlType(object.controlType),
    color: object.color,
    tintModel: object.tintModel === true,
    model: object.modelId ? { id: object.modelId } : undefined,
    hoistAxes: object.axes.map((axis, index) => ({
      index, key: axis.key, mount: mmMountToM(axis.mount), motorId: null, motorDisplayIndex: null,
    })),
    kinematics: sceneKinematicsForObject(object),
    parentId: object.parentId != null ? String(object.parentId) : null,
  };
}
