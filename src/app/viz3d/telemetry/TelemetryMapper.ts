import type {
  RuntimeTransform,
  SceneObjectConfig,
  SceneObjectStatus,
  TelemetryDeviceType,
  TelemetrySnapshotInput,
  Vec3,
} from "../types";

export const TELEMETRY_SCALE = {
  heightBaseMm: 2500,
  heightToWorldY: 1,
  planarBaseMm: 5000,
  planarToWorld: 1,
  degToRad: Math.PI / 180,
} as const;

const cloneVec3 = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export const snapshotToStatus = (status: SceneObjectStatus): SceneObjectStatus => status;

export const resolveRuntimeTransform = (
  base: SceneObjectConfig,
  snapshot: TelemetrySnapshotInput
): RuntimeTransform => {
  const position = cloneVec3(base.position);
  const rotation: Vec3 = { x: 0, y: 0, z: 0 };
  const values = snapshot.values;

  switch (snapshot.deviceType) {
    case "lift-truss":
    case "lift-pitch": {
      const height = values.height ?? TELEMETRY_SCALE.heightBaseMm;
      const deltaMm = height - TELEMETRY_SCALE.heightBaseMm;
      position.y = base.position.y - deltaMm * TELEMETRY_SCALE.heightToWorldY;
      rotation.x = -((values.pitch ?? 0) * TELEMETRY_SCALE.degToRad);
      rotation.y = (values.yaw ?? 0) * TELEMETRY_SCALE.degToRad;
      break;
    }
    case "mover": {
      const x = values.x ?? TELEMETRY_SCALE.planarBaseMm;
      const y = values.y ?? TELEMETRY_SCALE.planarBaseMm;
      position.x = base.position.x + (x - TELEMETRY_SCALE.planarBaseMm) * TELEMETRY_SCALE.planarToWorld;
      position.z = base.position.z + (y - TELEMETRY_SCALE.planarBaseMm) * TELEMETRY_SCALE.planarToWorld;
      break;
    }
    case "rotator": {
      rotation.y = (values.angle ?? 0) * TELEMETRY_SCALE.degToRad;
      break;
    }
    default:
      break;
  }

  const velocity =
    snapshot.speed > 0
      ? {
          x: 0,
          y: snapshot.speed / 100,
          z: 0,
        }
      : undefined;

  return { position, rotation, velocity };
};

export const inferDeviceTypeFromKeys = (keys: string[]): TelemetryDeviceType => {
  if (keys.includes("angle")) {
    return "rotator";
  }
  if (keys.includes("x") || keys.includes("y")) {
    return "mover";
  }
  return "lift-truss";
};
