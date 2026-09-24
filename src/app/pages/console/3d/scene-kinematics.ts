import type { VirtualAxisKinematics } from "@/app/viz3d";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";

export const sceneKinematicsForObject = (
  object: ControlledObject,
): VirtualAxisKinematics | undefined => {
  if (ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType].length === 0) return undefined;
  return {
    controlType: object.controlType,
    runDirection: object.modelRunDirection === 2 ? 2 : 1,
    pulleyDistance: object.pulleyDistance,
    maxHeight: object.motionParams?.move?.maxAngle ?? 0,
    betaInit: object.initialTiltDirection ?? 0,
  };
};

export const sceneKinematicsEqual = (
  a: VirtualAxisKinematics | undefined,
  b: VirtualAxisKinematics | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.controlType === b.controlType &&
    a.runDirection === b.runDirection &&
    a.pulleyDistance === b.pulleyDistance &&
    a.maxHeight === b.maxHeight &&
    a.betaInit === b.betaInit);
