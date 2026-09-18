import { TRAJECTORY_MODES } from "@shared/action-sequence";
import {
  CONTROL_TYPE_RULES,
  controlTypeHasMultiPointSwingParams,
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE,
  maxDriveAxesForControlType,
  SHAPE_DIMENSION_KEYS,
} from "./configuration-rules";
import type { ControlType, ShapePresetId } from "./configuration-types";
import {
  CONTROL_TYPE_CODES,
  decodeControlType,
  isControlTypeCode,
  type ControlTypeCode,
} from "./control-type-code";
import { PROJECT_SCHEMA_VERSION, type VirtualAxisId } from "./project-document-types";
import { INSTRUCTION_PRESET_IDS } from "./action-sequence/instruction-registry";

const CURRENT_WIZARD_STEPS = ["objects", "hardware", "binding", "review"] as const;
const SHAPE_PRESETS = Object.keys(SHAPE_DIMENSION_KEYS) as ShapePresetId[];
const VIRTUAL_AXES = ["v1", "v2", "v3"] as const;
const MOTION_PARAM_KEYS = [
  "minAngle",
  "maxAngle",
  "speed",
  "accelTime",
  "minAccelTime",
  "emergencyDecelTime",
  "acceleration",
  "deceleration",
  "maxAcceleration",
  "maxDeceleration",
  "abnormalDeceleration",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class StructuralAssertions {
  private invalid(path: string, expected: string): never {
    throw new Error(
      `Invalid ${PROJECT_SCHEMA_VERSION} project document at ${path}: ${expected}`,
    );
  }

  fail(path: string, expected: string): never {
    return this.invalid(path, expected);
  }

  record(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) return this.invalid(path, "expected an object");
    return value;
  }

  array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) return this.invalid(path, "expected an array");
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value !== "string") return this.invalid(path, "expected a string");
    return value;
  }

  optionalString(value: unknown, path: string): void {
    if (value !== undefined) this.string(value, path);
  }

  boolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") return this.invalid(path, "expected a boolean");
    return value;
  }

  optionalBoolean(value: unknown, path: string): void {
    if (value !== undefined) this.boolean(value, path);
  }

  finite(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return this.invalid(path, "expected a finite number");
    }
    return value;
  }

  optionalFinite(value: unknown, path: string): void {
    if (value !== undefined) this.finite(value, path);
  }

  nonNegativeFinite(value: unknown, path: string): number {
    const number = this.finite(value, path);
    if (number < 0) {
      return this.invalid(path, "expected a non-negative finite number");
    }
    return number;
  }

  nonNegativeInteger(value: unknown, path: string): number {
    const number = this.finite(value, path);
    if (!Number.isInteger(number) || number < 0) {
      return this.invalid(path, "expected a non-negative integer");
    }
    return number;
  }

  nullableString(value: unknown, path: string): string | null {
    if (value === null) return null;
    return this.string(value, path);
  }

  optionalNullableString(value: unknown, path: string): void {
    if (value !== undefined) this.nullableString(value, path);
  }

  enum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
    const text = this.string(value, path);
    if (!allowed.includes(text as T)) {
      return this.invalid(path, `expected one of ${allowed.join(", ")}`);
    }
    return text as T;
  }
}

const indexedPath = (path: string, index: number): string => `${path}[${index}]`;
const keyedPath = (path: string, key: string): string => `${path}[${JSON.stringify(key)}]`;

const validateStringArray = (value: unknown, path: string, a: StructuralAssertions): void => {
  a.array(value, path).forEach((item, index) => a.string(item, indexedPath(path, index)));
};

const validateSetupEntityId = (value: unknown, path: string, a: StructuralAssertions): number => {
  const id = a.nonNegativeInteger(value, path);
  if (id < 1 || id > 65535) a.fail(path, "expected integer in 1~65535");
  return id;
};

const validateSetupEntityIdArray = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
): void => {
  a.array(value, path).forEach((item, index) =>
    validateSetupEntityId(item, indexedPath(path, index), a),
  );
};

const validateEnumArray = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  a: StructuralAssertions,
): void => {
  a.array(value, path).forEach((item, index) => a.enum(item, allowed, indexedPath(path, index)));
};

const validateVector = (value: unknown, path: string, a: StructuralAssertions): void => {
  const vector = a.record(value, path);
  for (const key of ["x", "y", "z"] as const) a.finite(vector[key], `${path}.${key}`);
};

const validateDimensions = (value: unknown, path: string, a: StructuralAssertions): void => {
  const dimensions = a.record(value, path);
  for (const key of ["w", "h", "d"] as const) a.finite(dimensions[key], `${path}.${key}`);
};

const validateWizard = (
  value: unknown,
  allowedSteps: readonly string[],
  path: string,
  a: StructuralAssertions,
): void => {
  const wizard = a.record(value, path);
  a.enum(wizard.currentStep, allowedSteps, `${path}.currentStep`);
  validateEnumArray(wizard.completedSteps, allowedSteps, `${path}.completedSteps`, a);
  validateEnumArray(wizard.skippedSteps, allowedSteps, `${path}.skippedSteps`, a);
  a.boolean(wizard.simulationOnly, `${path}.simulationOnly`);
  a.boolean(wizard.wizardCompleted, `${path}.wizardCompleted`);
};

const validateMeta = (
  value: unknown,
  wizardSteps: readonly string[],
  path: string,
  a: StructuralAssertions,
): void => {
  const meta = a.record(value, path);
  for (const key of ["id", "name", "createdAt", "modifiedAt", "author"] as const) {
    a.string(meta[key], `${path}.${key}`);
  }
  if (meta.status !== undefined) {
    a.enum(meta.status, ["active", "draft", "archived"], `${path}.status`);
  }
  a.optionalString(meta.note, `${path}.note`);
  if (meta.tags !== undefined) validateStringArray(meta.tags, `${path}.tags`, a);
  validateWizard(meta.wizard, wizardSteps, `${path}.wizard`, a);
};

const validatePlc = (value: unknown, path: string, a: StructuralAssertions): void => {
  const plc = a.record(value, path);
  validateSetupEntityId(plc.id, `${path}.id`, a);
  a.string(plc.ip, `${path}.ip`);
  a.string(plc.masterTypeId, `${path}.masterTypeId`);
};

const validateParamsRecord = (value: unknown, path: string, a: StructuralAssertions): void => {
  const params = a.record(value, path);
  for (const [key, item] of Object.entries(params)) {
    if (typeof item === "number") a.finite(item, keyedPath(path, key));
    else if (typeof item === "boolean" || typeof item === "string") continue;
    else a.fail(keyedPath(path, key), "expected number, boolean, or string");
  }
};

const validateMotor = (value: unknown, path: string, a: StructuralAssertions): void => {
  const motor = a.record(value, path);
  a.string(motor.productModel, `${path}.productModel`);
  validateSetupEntityId(motor.id, `${path}.id`, a);
  validateSetupEntityId(motor.plcId, `${path}.plcId`, a);
  if (motor.mid !== undefined) a.fail(`${path}.mid`, "unexpected mid (use id)");
  const busNo = a.finite(motor.busNo, `${path}.busNo`);
  if (busNo !== 0 && busNo !== 1) a.fail(`${path}.busNo`, "expected 0 or 1");
  const axisType = a.finite(motor.axisType, `${path}.axisType`);
  if (axisType !== 0 && axisType !== 1) a.fail(`${path}.axisType`, "expected 0 or 1");
  a.nullableString(motor.nodeAddress, `${path}.nodeAddress`);
  a.optionalNullableString(motor.discoveryId, `${path}.discoveryId`);
  if (motor.controlledObjectId === null) {
    /* ok */
  } else {
    validateSetupEntityId(motor.controlledObjectId, `${path}.controlledObjectId`, a);
  }
  a.nullableString(motor.axisKey, `${path}.axisKey`);
  validateParamsRecord(motor.params, `${path}.params`, a);
};

const validateDriveAxisMount = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
  required: boolean,
): void => {
  if (value === undefined) {
    if (required) a.fail(path, "expected mount coordinates");
    return;
  }
  const mount = a.record(value, path);
  a.finite(mount.x, `${path}.x`);
  a.finite(mount.z, `${path}.z`);
};

const validateMountLayout = (
  value: unknown,
  path: string,
  axisCount: number,
  a: StructuralAssertions,
): void => {
  if (value === undefined) return;
  const layout = a.record(value, path);
  const kind = a.string(layout.kind, `${path}.kind`);
  if (kind === "custom") return;
  if (kind === "line") {
    const spacings = a.array(layout.spacings, `${path}.spacings`);
    const expected = axisCount - 1;
    if (spacings.length !== expected) {
      a.fail(
        `${path}.spacings`,
        `expected ${expected} spacings to match driveAxes`,
      );
    }
    for (let index = 0; index < spacings.length; index += 1) {
      const spacing = a.finite(spacings[index], `${path}.spacings[${index}]`);
      if (spacing <= 0) {
        a.fail(`${path}.spacings[${index}]`, "expected a positive number");
      }
    }
    return;
  }
  if (kind !== "circle") {
    a.fail(`${path}.kind`, 'expected "custom", "line" or "circle"');
  }
  const radius = a.finite(layout.radius, `${path}.radius`);
  if (radius <= 0) {
    a.fail(`${path}.radius`, "expected a positive number");
  }
  const chordLengths = a.array(layout.chordLengths, `${path}.chordLengths`);
  if (chordLengths.length !== axisCount) {
    a.fail(
      `${path}.chordLengths`,
      `expected ${axisCount} chord lengths to match driveAxes`,
    );
  }
  for (let index = 0; index < chordLengths.length; index += 1) {
    const chord = a.finite(chordLengths[index], `${path}.chordLengths[${index}]`);
    if (chord <= 0) {
      a.fail(`${path}.chordLengths[${index}]`, "expected a positive number");
    }
  }
};

const validateDriveAxes = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
  requireMount = false,
): void => {
  const usedKeys = new Set<string>();
  a.array(value, path).forEach((item, index) => {
    const axisPath = indexedPath(path, index);
    const axis = a.record(item, axisPath);
    const key = a.string(axis.key, `${axisPath}.key`);
    if (usedKeys.has(key)) a.fail(`${axisPath}.key`, `duplicate drive axis key "${key}"`);
    usedKeys.add(key);
    a.optionalBoolean(axis.custom, `${axisPath}.custom`);
    validateDriveAxisMount(axis.mount, `${axisPath}.mount`, a, requireMount);
  });
};

const validateObjectBase = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
  options: { requireMount?: boolean } = {},
): Record<string, unknown> => {
  const object = a.record(value, path);
  validateSetupEntityId(object.id, `${path}.id`, a);
  a.string(object.name, `${path}.name`);
  validateEnumArray(object.enabledVirtualAxes, VIRTUAL_AXES, `${path}.enabledVirtualAxes`, a);
  a.optionalString(object.modelId, `${path}.modelId`);
  validateDimensions(object.dimensions, `${path}.dimensions`, a);
  validateVector(object.position, `${path}.position`, a);
  validateVector(object.centerOffset, `${path}.centerOffset`, a);
  a.string(object.color, `${path}.color`);
  a.optionalNullableString(object.parentId, `${path}.parentId`);
  validateDriveAxes(object.driveAxes, `${path}.driveAxes`, a, options.requireMount ?? false);
  return object;
};

const validateShapeDimensions = (
  value: unknown,
  shapePreset: ShapePresetId,
  path: string,
  a: StructuralAssertions,
): void => {
  const dimensions = a.record(value, path);
  for (const key of SHAPE_DIMENSION_KEYS[shapePreset]) {
    a.finite(dimensions[key], `${path}.${key}`);
  }
};

const validateMotionAxisParams = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
): void => {
  const params = a.record(value, path);
  for (const key of MOTION_PARAM_KEYS) a.finite(params[key], `${path}.${key}`);
};

const validateMotionParams = (
  value: unknown,
  controlType: ControlType,
  path: string,
  a: StructuralAssertions,
): void => {
  const motionParams = a.record(value, path);
  const expectedAxes = CONTROL_TYPE_RULES[controlType].motionAxes;
  
  for (const axis of expectedAxes) {
    if (motionParams[axis] === undefined) {
      a.fail(path, `missing expected motion axis "${axis}" for control type "${controlType}"`);
    }
  }
  
  for (const axis of Object.keys(motionParams)) {
    if (!expectedAxes.includes(axis as never)) {
      a.fail(path, `unexpected motion axis "${axis}" for control type "${controlType}"`);
    }
    validateMotionAxisParams(motionParams[axis], `${path}.${axis}`, a);
  }
};

const validateControlTypeCode = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
): ControlType => {
  const code = a.nonNegativeInteger(value, path);
  if (!isControlTypeCode(code)) {
    a.fail(path, `expected one of ${CONTROL_TYPE_CODES.join(", ")}`);
  }
  return decodeControlType(code as ControlTypeCode);
};

const validateCurrentObject = (value: unknown, path: string, a: StructuralAssertions): void => {
  const object = validateObjectBase(value, path, a, { requireMount: true });
  if ("deviceType" in object) a.string(undefined, `${path}.deviceType`);
  const controlType = validateControlTypeCode(object.controlType, `${path}.controlType`, a);
  const shapePreset = a.enum(object.shapePreset, SHAPE_PRESETS, `${path}.shapePreset`);
  const driveAxes = a.array(object.driveAxes, `${path}.driveAxes`);
  const minimumDriveAxes = CONTROL_TYPE_RULES[controlType].minimumDriveAxes;
  if (driveAxes.length < minimumDriveAxes) {
    a.fail(`${path}.driveAxes`, `expected at least ${minimumDriveAxes} drive axes`);
  }
  const maximumDriveAxes = maxDriveAxesForControlType(controlType);
  if (maximumDriveAxes !== undefined && driveAxes.length > maximumDriveAxes) {
    a.fail(`${path}.driveAxes`, `expected at most ${maximumDriveAxes} drive axes`);
  }
  const pulleyDistance = a.finite(object.pulleyDistance, `${path}.pulleyDistance`);
  if (pulleyDistance < 0) {
    a.fail(`${path}.pulleyDistance`, "expected a non-negative number");
  }
  const modelRunDirection = a.finite(object.modelRunDirection, `${path}.modelRunDirection`);
  if (modelRunDirection !== 1 && modelRunDirection !== 2) {
    a.fail(`${path}.modelRunDirection`, "expected 1 (forward) or 2 (reverse)");
  }
  if (controlTypeHasMultiPointSwingParams(controlType)) {
    const safetyRadius = a.finite(object.safetyRadius, `${path}.safetyRadius`);
    if (safetyRadius < 0) {
      a.fail(`${path}.safetyRadius`, "expected a non-negative number");
    }
    const initialTiltDirection = a.finite(
      object.initialTiltDirection,
      `${path}.initialTiltDirection`,
    );
    if (initialTiltDirection < 0 || initialTiltDirection > 360) {
      a.fail(`${path}.initialTiltDirection`, "expected a number in [0, 360]");
    }
    const mountRotation = a.finite(object.mountRotation, `${path}.mountRotation`);
    if (mountRotation < 0 || mountRotation > 360) {
      a.fail(`${path}.mountRotation`, "expected a number in [0, 360]");
    }
    validateMountLayout(object.mountLayout, `${path}.mountLayout`, driveAxes.length, a);
  } else {
    if (object.mountLayout !== undefined) {
      a.fail(`${path}.mountLayout`, "expected mountLayout only for multi-point swing");
    }
    if (object.mountRotation !== undefined) {
      a.fail(`${path}.mountRotation`, "expected mountRotation only for multi-point swing");
    }
  }
  validateVector(object.rotation, `${path}.rotation`, a);
  const rotation = a.record(object.rotation, `${path}.rotation`);
  for (const axis of ["x", "y", "z"] as const) {
    const angle = a.finite(rotation[axis], `${path}.rotation.${axis}`);
    if (angle < 0 || angle > 360) {
      a.fail(`${path}.rotation.${axis}`, "expected a number in [0, 360]");
    }
  }
  validateShapeDimensions(object.shapeDimensions, shapePreset, `${path}.shapeDimensions`, a);
  validateMotionParams(object.motionParams, controlType, `${path}.motionParams`, a);
  const maxAxisVelocity = a.finite(object.maxAxisVelocity, `${path}.maxAxisVelocity`);
  if (maxAxisVelocity <= 0) {
    a.fail(`${path}.maxAxisVelocity`, "expected a positive number");
  }
  const enabled: readonly VirtualAxisId[] = ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType];
  if (enabled.includes("v2")) {
    const pDefaultMaxVelocity = a.finite(object.pDefaultMaxVelocity, `${path}.pDefaultMaxVelocity`);
    if (pDefaultMaxVelocity <= 0) {
      a.fail(`${path}.pDefaultMaxVelocity`, "expected a positive number");
    }
  } else if (object.pDefaultMaxVelocity !== undefined) {
    a.fail(`${path}.pDefaultMaxVelocity`, "expected pDefaultMaxVelocity only when virtual axis v2 is enabled");
  }
  if (enabled.includes("v3")) {
    const yDefaultMaxVelocity = a.finite(object.yDefaultMaxVelocity, `${path}.yDefaultMaxVelocity`);
    if (yDefaultMaxVelocity <= 0) {
      a.fail(`${path}.yDefaultMaxVelocity`, "expected a positive number");
    }
  } else if (object.yDefaultMaxVelocity !== undefined) {
    a.fail(`${path}.yDefaultMaxVelocity`, "expected yDefaultMaxVelocity only when virtual axis v3 is enabled");
  }
  if (object.params !== undefined) {
    const params = a.record(object.params, `${path}.params`);
    for (const [key, item] of Object.entries(params)) {
      a.finite(item, keyedPath(`${path}.params`, key));
    }
  }
};

const validateAlignment = (value: unknown, path: string, a: StructuralAssertions): void => {
  const alignment = a.record(value, path);
  for (const [objectId, item] of Object.entries(alignment)) {
    const itemPath = keyedPath(path, objectId);
    const record = a.record(item, itemPath);
    if (record.method !== null) {
      a.enum(record.method, ["distance", "calibrate"], `${itemPath}.method`);
    }
    a.enum(record.status, ["not_started", "in_progress", "aligned"], `${itemPath}.status`);
    a.nullableString(record.alignedAt, `${itemPath}.alignedAt`);
  }
};

const validateScene = (value: unknown, path: string, a: StructuralAssertions): void => {
  if (value === undefined) return;
  const scene = a.record(value, path);
  if (scene.groups === undefined) return;
  a.array(scene.groups, `${path}.groups`).forEach((item, index) => {
    const groupPath = indexedPath(`${path}.groups`, index);
    const group = a.record(item, groupPath);
    a.string(group.id, `${groupPath}.id`);
    a.string(group.name, `${groupPath}.name`);
    validateSetupEntityIdArray(group.objectIds, `${groupPath}.objectIds`, a);
  });
};

const validateSetup = (value: unknown, path: string, a: StructuralAssertions): void => {
  const setup = a.record(value, path);
  a.array(setup.plcs, `${path}.plcs`).forEach((plc, index) =>
    validatePlc(plc, indexedPath(`${path}.plcs`, index), a),
  );
  const motors = a.array(setup.motors, `${path}.motors`);
  motors.forEach((motor, index) =>
    validateMotor(motor, indexedPath(`${path}.motors`, index), a),
  );
  a.array(setup.controlledObjects, `${path}.controlledObjects`).forEach((object, index) => {
    validateCurrentObject(object, indexedPath(`${path}.controlledObjects`, index), a);
  });
  const usedIds = new Map<number, string>();
  const claim = (id: number, ownerPath: string) => {
    const existing = usedIds.get(id);
    if (existing !== undefined) {
      a.fail(ownerPath, `duplicate setup entity id ${id} (also at ${existing})`);
    }
    usedIds.set(id, ownerPath);
  };
  a.array(setup.plcs, `${path}.plcs`).forEach((item, index) => {
    const plc = a.record(item, indexedPath(`${path}.plcs`, index));
    claim(
      validateSetupEntityId(plc.id, indexedPath(`${path}.plcs`, index) + ".id", a),
      indexedPath(`${path}.plcs`, index) + ".id",
    );
  });
  motors.forEach((item, index) => {
    const motor = a.record(item, indexedPath(`${path}.motors`, index));
    claim(
      validateSetupEntityId(motor.id, indexedPath(`${path}.motors`, index) + ".id", a),
      indexedPath(`${path}.motors`, index) + ".id",
    );
  });
  a.array(setup.controlledObjects, `${path}.controlledObjects`).forEach((item, index) => {
    const object = a.record(item, indexedPath(`${path}.controlledObjects`, index));
    claim(
      validateSetupEntityId(
        object.id,
        indexedPath(`${path}.controlledObjects`, index) + ".id",
        a,
      ),
      indexedPath(`${path}.controlledObjects`, index) + ".id",
    );
  });
  validateAlignment(setup.alignment, `${path}.alignment`, a);
  validateScene(setup.scene, `${path}.scene`, a);
};

const TIMELINE_BLOCK_KINDS = ["pose", "instruction", "static-preset", "dynamic-preset"] as const;
const MOTION_PROFILE_KINDS = ["trapezoid", "idle"] as const;

const validateMotionProfile = (value: unknown, path: string, a: StructuralAssertions): void => {
  const profile = a.record(value, path);
  a.enum(profile.kind, MOTION_PROFILE_KINDS, `${path}.kind`);
  if (profile.kind === "idle") {
    if (profile.params !== undefined) {
      a.fail(`${path}.params`, "idle profiles must not have params");
    }
    return;
  }
  const params = a.record(profile.params, `${path}.params`);
  a.finite(params.accelMs, `${path}.params.accelMs`);
  a.finite(params.decelMs, `${path}.params.decelMs`);
};

const validateAxisMotionProfiles = (value: unknown, path: string, a: StructuralAssertions): void => {
  const profiles = a.record(value, path);
  validateMotionProfile(profiles.v1, `${path}.v1`, a);
  validateMotionProfile(profiles.v2, `${path}.v2`, a);
  validateMotionProfile(profiles.v3, `${path}.v3`, a);
};

const validateModelPose = (value: unknown, path: string, a: StructuralAssertions): void => {
  const pose = a.record(value, path);
  a.finite(pose.v1, `${path}.v1`);
  a.finite(pose.v2, `${path}.v2`);
  a.finite(pose.v3, `${path}.v3`);
};

const validatePresetParams = (value: unknown, path: string, a: StructuralAssertions): void => {
  const params = a.record(value, path);
  for (const [key, paramValue] of Object.entries(params)) {
    const paramPath = keyedPath(path, key);
    if (typeof paramValue === "number") {
      a.finite(paramValue, paramPath);
      continue;
    }
    if (typeof paramValue !== "string" && typeof paramValue !== "boolean") {
      a.fail(paramPath, "expected a number, string, or boolean");
    }
  }
};

const validatePresetBlockBase = (
  block: Record<string, unknown>,
  path: string,
  a: StructuralAssertions,
): void => {
  a.string(block.presetId, `${path}.presetId`);
  validateSetupEntityIdArray(block.orderedObjectIds, `${path}.orderedObjectIds`, a);
  validatePresetParams(block.params, `${path}.params`, a);
};

const validateTimelineBlock = (value: unknown, path: string, a: StructuralAssertions): void => {
  const block = a.record(value, path);
  a.string(block.id, `${path}.id`);
  a.optionalString(block.label, `${path}.label`);
  const kind = a.enum(block.kind, TIMELINE_BLOCK_KINDS, `${path}.kind`);

  switch (kind) {
    case "pose":
      validateSetupEntityId(block.objectId, `${path}.objectId`, a);
      a.nonNegativeFinite(block.atMs, `${path}.atMs`);
      validateModelPose(block.pose, `${path}.pose`, a);
      break;
    case "instruction":
      validateSetupEntityId(block.objectId, `${path}.objectId`, a);
      a.nonNegativeFinite(block.atMs, `${path}.atMs`);
      a.enum(block.presetId, INSTRUCTION_PRESET_IDS, `${path}.presetId`);
      if (block.enabled !== undefined) {
        a.fail(`${path}.enabled`, "instruction enabled must live in instr");
      }
      {
        const instr = a.record(block.instr, `${path}.instr`);
        a.boolean(instr.enabled, `${path}.instr.enabled`);
        for (const key of Object.keys(instr)) {
          if (key !== "enabled") {
            a.fail(keyedPath(`${path}.instr`, key), "unknown instruction parameter");
          }
        }
      }
      break;
    case "static-preset":
      validatePresetBlockBase(block, path, a);
      a.nonNegativeFinite(block.atMs, `${path}.atMs`);
      break;
    case "dynamic-preset":
      validatePresetBlockBase(block, path, a);
      a.nonNegativeFinite(block.startMs, `${path}.startMs`);
      a.nonNegativeFinite(block.endMs, `${path}.endMs`);
      validateAxisMotionProfiles(block.profiles, `${path}.profiles`, a);
      break;
  }
};

const validateSequence = (value: unknown, path: string, a: StructuralAssertions): void => {
  const sequence = a.record(value, path);
  validateSetupEntityId(sequence.id, `${path}.id`, a);
  a.string(sequence.name, `${path}.name`);
  a.optionalString(sequence.note, `${path}.note`);
  a.enum(sequence.trajectoryMode, TRAJECTORY_MODES, `${path}.trajectoryMode`);
  a.optionalBoolean(sequence.loop, `${path}.loop`);
  if (sequence.initialPoses !== undefined) {
    a.fail(`${path}.initialPoses`, "legacy initialPoses are not accepted");
  }
  a.array(sequence.blocks, `${path}.blocks`).forEach((block, index) =>
    validateTimelineBlock(block, indexedPath(`${path}.blocks`, index), a),
  );
  a.array(sequence.segments, `${path}.segments`).forEach((item, index) => {
    const segmentPath = indexedPath(`${path}.segments`, index);
    const segment = a.record(item, segmentPath);
    a.string(segment.fromRef, `${segmentPath}.fromRef`);
    a.string(segment.toRef, `${segmentPath}.toRef`);
    const settings = a.record(segment.settings, `${segmentPath}.settings`);
    if (settings.curve !== undefined) {
      a.fail(`${segmentPath}.settings.curve`, "legacy curve is not accepted");
    }
    validateAxisMotionProfiles(settings.profiles, `${segmentPath}.settings.profiles`, a);
  });
  if (sequence.tracks !== undefined) {
    a.fail(`${path}.tracks`, "legacy tracks are not accepted");
  }
};

const validateProgram = (value: unknown, path: string, a: StructuralAssertions): void => {
  const program = a.record(value, path);
  a.string(program.id, `${path}.id`);
  a.string(program.name, `${path}.name`);
  a.optionalString(program.note, `${path}.note`);
  a.array(program.chapters, `${path}.chapters`).forEach((item, index) => {
    const chapterPath = indexedPath(`${path}.chapters`, index);
    const chapter = a.record(item, chapterPath);
    a.string(chapter.id, `${chapterPath}.id`);
    a.string(chapter.name, `${chapterPath}.name`);
    a.optionalString(chapter.note, `${chapterPath}.note`);
    a.array(chapter.items, `${chapterPath}.items`).forEach((chapterItem, itemIndex) => {
      const itemPath = indexedPath(`${chapterPath}.items`, itemIndex);
      const reference = a.record(chapterItem, itemPath);
      a.enum(reference.kind, ["sequence"], `${itemPath}.kind`);
      validateSetupEntityId(reference.refId, `${itemPath}.refId`, a);
    });
  });
};

const validateMotion = (value: unknown, path: string, a: StructuralAssertions): void => {
  const motion = a.record(value, path);
  const sequences = a.array(motion.actionSequences, `${path}.actionSequences`);
  sequences.forEach((sequence, index) =>
    validateSequence(sequence, indexedPath(`${path}.actionSequences`, index), a),
  );
  const usedSequenceIds = new Map<number, string>();
  sequences.forEach((item, index) => {
    const sequence = a.record(item, indexedPath(`${path}.actionSequences`, index));
    const ownerPath = indexedPath(`${path}.actionSequences`, index) + ".id";
    const id = validateSetupEntityId(sequence.id, ownerPath, a);
    const existing = usedSequenceIds.get(id);
    if (existing !== undefined) {
      a.fail(ownerPath, `duplicate sequence id ${id} (also at ${existing})`);
    }
    usedSequenceIds.set(id, ownerPath);
  });
  a.array(motion.programs, `${path}.programs`).forEach((program, index) =>
    validateProgram(program, indexedPath(`${path}.programs`, index), a),
  );
};

const validateRules = (value: unknown, path: string, a: StructuralAssertions): void => {
  const rules = a.record(value, path);
  a.array(rules.rules, `${path}.rules`).forEach((item, index) => {
    const rulePath = indexedPath(`${path}.rules`, index);
    const rule = a.record(item, rulePath);
    a.string(rule.id, `${rulePath}.id`);
    a.string(rule.name, `${rulePath}.name`);
    a.boolean(rule.enabled, `${rulePath}.enabled`);
    a.optionalString(rule.note, `${rulePath}.note`);
  });
};

const VIEW_PRESETS = ["top", "front", "back", "side", "left", "persp", "iso"] as const;
const GRID_SIZES = [10, 20, 40, 80] as const;

const validateSavedView = (value: unknown, path: string, a: StructuralAssertions): void => {
  const view = a.record(value, path);
  const target = a.array(view.target, `${path}.target`);
  if (target.length !== 3) {
    a.fail(`${path}.target`, "expected [x,y,z]");
  }
  target.forEach((n, i) => a.finite(n, `${path}.target[${i}]`));
  a.finite(view.alpha, `${path}.alpha`);
  a.finite(view.beta, `${path}.beta`);
  a.finite(view.zoomRadius, `${path}.zoomRadius`);
  a.finite(view.orthoHalfHeight, `${path}.orthoHalfHeight`);
  a.enum(view.preset, VIEW_PRESETS, `${path}.preset`);
  a.finite(view.focalLengthMm, `${path}.focalLengthMm`);
  const gridSize = a.finite(view.gridSize, `${path}.gridSize`);
  if (!(GRID_SIZES as readonly number[]).includes(gridSize)) {
    a.fail(`${path}.gridSize`, `expected one of ${GRID_SIZES.join(", ")}`);
  }
};

const validateSnapshotPayloadEnvelope = (
  value: unknown,
  path: string,
  a: StructuralAssertions,
): void => {
  const payload = a.record(value, path);
  a.enum(payload.schemaVersion, [PROJECT_SCHEMA_VERSION], `${path}.schemaVersion`);
  validateMeta(payload.meta, CURRENT_WIZARD_STEPS, `${path}.meta`, a);
  validateSetup(payload.setup, `${path}.setup`, a);
  validateMotion(payload.motion, `${path}.motion`, a);
  validateRules(payload.rules, `${path}.rules`, a);
};

const validateSnapshots = (value: unknown, path: string, a: StructuralAssertions): void => {
  a.array(value, path).forEach((item, index) => {
    const snapshotPath = indexedPath(path, index);
    const snapshot = a.record(item, snapshotPath);
    a.string(snapshot.id, `${snapshotPath}.id`);
    a.string(snapshot.label, `${snapshotPath}.label`);
    a.string(snapshot.createdAt, `${snapshotPath}.createdAt`);
    a.optionalString(snapshot.author, `${snapshotPath}.author`);
    a.optionalString(snapshot.note, `${snapshotPath}.note`);
    validateSnapshotPayloadEnvelope(snapshot.payload, `${snapshotPath}.payload`, a);
  });
};

const validateDocument = (input: unknown): void => {
  const a = new StructuralAssertions();
  const document = a.record(input, "$");
  a.enum(document.schemaVersion, [PROJECT_SCHEMA_VERSION], "schemaVersion");
  validateMeta(document.meta, CURRENT_WIZARD_STEPS, "meta", a);
  validateSetup(document.setup, "setup", a);
  validateMotion(document.motion, "motion", a);
  validateRules(document.rules, "rules", a);
  validateSavedView(document.view, "view", a);
  validateSnapshots(document.snapshots, "snapshots", a);
};

export const assertProjectDocumentStructure = (input: unknown): void =>
  validateDocument(input);
