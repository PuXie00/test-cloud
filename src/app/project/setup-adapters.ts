import type { ControlledObject } from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import type { ControlledObjectConfig } from "./project-document-types";
import { resolveSwingYawModelParams } from "./configuration-rules";
import { decodeControlType } from "./control-type-code";
import {
  DEFAULT_MODEL_RUN_DIRECTION,
  DEFAULT_PULLEY_DISTANCE,
  defaultMountForAxisIndex,
  normalizeModelRunDirection,
} from "./hoist-point-defaults";
import { normalizeMaxAxisVelocity } from "./motion-speed";
import { normalizeMotionParams } from "./motion-acceleration";
import { normalizeObjectRotationDeg } from "./object-rotation";

export const controlledObjectConfigToWizard = (
  config: ControlledObjectConfig,
): ControlledObject => {
  const controlType = decodeControlType(config.controlType);
  return {
    id: config.id,
    name: config.name,
    controlType,
    shapePreset: config.shapePreset,
    shapeDimensions: config.shapeDimensions,
    dimensions: config.dimensions,
    position: config.position,
    centerOffset: config.centerOffset,
    rotation: normalizeObjectRotationDeg(config.rotation, controlType),
    color: config.color,
    motionParams: normalizeMotionParams(config.motionParams),
    motionSpeedControl: config.motionSpeedControl,
    maxAxisVelocity: normalizeMaxAxisVelocity(config.maxAxisVelocity),
    ...(config.pDefaultMaxVelocity !== undefined ? { pDefaultMaxVelocity: config.pDefaultMaxVelocity } : {}),
    ...(config.yDefaultMaxVelocity !== undefined ? { yDefaultMaxVelocity: config.yDefaultMaxVelocity } : {}),
    pulleyDistance: config.pulleyDistance ?? DEFAULT_PULLEY_DISTANCE,
    modelRunDirection: normalizeModelRunDirection(
      config.modelRunDirection ?? DEFAULT_MODEL_RUN_DIRECTION,
    ),
    ...resolveSwingYawModelParams(controlType, config),
    ...(config.mountLayout !== undefined ? { mountLayout: config.mountLayout } : {}),
    axes: config.driveAxes.map((axis, index) => ({
      key: axis.key,
      custom: axis.custom ?? false,
      mount: axis.mount ?? defaultMountForAxisIndex(controlType, index),
    })),
    modelId: config.modelId,
    params: { ...config.params },
  };
};
