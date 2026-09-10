import type { ControlledObject } from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import type {
  ControlledObjectDescriptor,
  ControlledObjectSnapshot,
  ControlledObjectStatus,
  ControlledObjectType,
} from "@/app/pages/console/components/monitor-grid/monitor-data";
import { TELEMETRY_SCALE } from "@/app/viz3d/telemetry/TelemetryMapper";
import { CONTROL_TYPE_RULES, ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "./configuration-rules";
import type { ControlType } from "./configuration-types";
import type { VirtualAxisId, VirtualAxisValues } from "./project-document-types";
import { virtualAxisDescriptor } from "./virtual-axis-mapping";

const controlTypeToMonitorType = (controlType: ControlType): ControlledObjectType => {
  switch (controlType) {
    case "singlePointRotation":
    case "continuousRotation":
      return "rotator";
    case "fourPointSwing":
    case "dualTiltFourPointSwing":
    case "multiPointSwing":
      return "lift-pitch";
    case "twoPointSwing":
      return "lift-truss";
    case "singlePointMove":
    case "multiLevelHoist":
      return "mover";
    case "railCar":
    case "staticProp":
    default:
      return "lift-truss";
  }
};

const enabledAxesForObject = (object: ControlledObject): VirtualAxisId[] => [
  ...ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType],
];

export const wizardObjectToMonitorDescriptor = (
  object: ControlledObject,
  status: ControlledObjectStatus = "ready",
): ControlledObjectDescriptor => {
  const axes = enabledAxesForObject(object);
  const motionAxes = CONTROL_TYPE_RULES[object.controlType].motionAxes;
  return {
    id: object.id,
    name: object.name,
    type: controlTypeToMonitorType(object.controlType),
    status,
    dimensions: axes.map((axis) => {
      const { key, label, unit } = virtualAxisDescriptor(motionAxes, axis);
      return { key, label, unit };
    }),
  };
};

/** 遥测中立位：mesh 保持 Viz3DObjectSync 配置位置 */
export const neutralTelemetryValues = (descriptor: ControlledObjectDescriptor): Record<string, number> => {
  const values: Record<string, number> = {};
  descriptor.dimensions.forEach((dim) => {
    if (dim.key === "height") values[dim.key] = TELEMETRY_SCALE.heightBaseMm;
    else if (dim.key === "x" || dim.key === "y") values[dim.key] = TELEMETRY_SCALE.planarBaseMm;
    else values[dim.key] = 0;
  });
  return values;
};

export const virtualAxisValuesToMonitorValues = (
  virtual: VirtualAxisValues,
  descriptor: ControlledObjectDescriptor,
): Record<string, number> => {
  const values = neutralTelemetryValues(descriptor);
  const dims = descriptor.dimensions;
  if (virtual.v1 !== undefined && dims[0]) values[dims[0].key] = virtual.v1;
  if (virtual.v2 !== undefined && dims[1]) values[dims[1].key] = virtual.v2;
  if (virtual.v3 !== undefined && dims[2]) values[dims[2].key] = virtual.v3;
  return values;
};

export const buildStaticMonitorSnapshot = (
  descriptor: ControlledObjectDescriptor,
  values?: Record<string, number>,
): ControlledObjectSnapshot => {
  const baseValues = values ?? neutralTelemetryValues(descriptor);
  return {
    descriptor,
    values: { ...baseValues },
    targets: { ...baseValues },
    speed: 0,
    torquePercent: 0,
    temperatureC: 35,
    history: Array.from({ length: 12 }, () => 0),
    live: false,
    positions: null,
    modelStatus: null,
  };
};
