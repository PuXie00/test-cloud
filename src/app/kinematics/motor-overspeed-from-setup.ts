import { decodeControlType } from "@/app/project/control-type-code";
import type { ControlledObjectConfig, MotorConfig } from "@/app/project/project-document-types";
import type { Vec3 } from "./multi-point-forward";
import type { MotorOverspeedMotor, MotorOverspeedObject } from "./motor-overspeed";

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const originDistances = (
  object: ControlledObjectConfig,
): { baseHeight1: number; baseHeight2: number } =>
  object.modelRunDirection === 2
    ? { baseHeight1: 0, baseHeight2: object.pulleyDistance }
    : { baseHeight1: object.pulleyDistance, baseHeight2: 0 };

const pointInitPosOf = (object: ControlledObjectConfig): Vec3[] =>
  object.driveAxes.map((axis) => {
    const mount = axis.mount ?? { x: 0, z: 0 };
    return [mount.x, mount.z, 0];
  });

const motorsForObject = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): MotorOverspeedMotor[] =>
  object.driveAxes.flatMap((axis) => {
    const motor = motors.find(
      (item) => item.controlledObjectId === object.id && item.axisKey === axis.key,
    );
    if (!motor) return [];
    const maxAxisVelocity = isPositiveFinite(motor.params.maxAxisVelocity)
      ? Number(motor.params.maxAxisVelocity)
      : object.maxAxisVelocity;
    if (!isPositiveFinite(maxAxisVelocity)) return [];
    return [
      {
        id: motor.id,
        name: motor.productModel || `电机 ${motor.id}`,
        maxAxisVelocity,
      },
    ];
  });

export const buildMotorOverspeedObjects = (
  objects: readonly ControlledObjectConfig[],
  motors: readonly MotorConfig[],
): MotorOverspeedObject[] =>
  objects.flatMap((object) => {
    if (decodeControlType(object.controlType) !== "multiPointSwing") return [];
    const pointInitPos = pointInitPosOf(object);
    const boundMotors = motorsForObject(object, motors);
    if (pointInitPos.length === 0 || boundMotors.length === 0) return [];
    const origins = originDistances(object);
    return [
      {
        objectId: object.id,
        pointInitPos,
        ...origins,
        maxHeight: object.motionParams.move?.maxAngle ?? 0,
        betaInit: object.initialTiltDirection ?? 0,
        motors: boundMotors,
      },
    ];
  });
