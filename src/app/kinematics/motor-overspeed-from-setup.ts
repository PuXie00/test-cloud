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

/** PLC 运行中每个电机都按该物体所有电机最大速度里的最小值限速 */
const withSharedVelocityLimit = (motors: MotorOverspeedMotor[]): MotorOverspeedMotor[] => {
  const limit = Math.min(...motors.map((motor) => motor.maxAxisVelocity));
  return motors.map((motor) => ({ ...motor, maxAxisVelocity: limit }));
};

const motorsForObject = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[],
): MotorOverspeedMotor[] =>
  withSharedVelocityLimit(
    object.driveAxes.flatMap((axis, ropeIndex) => {
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
          ropeIndex,
        },
      ];
    }),
  );

export const buildMotorOverspeedObjects = (
  objects: readonly ControlledObjectConfig[],
  motors: readonly MotorConfig[],
): MotorOverspeedObject[] =>
  objects.flatMap((object) => {
    const controlType = decodeControlType(object.controlType);
    if (controlType !== "multiPointSwing" && controlType !== "dualTiltFourPointSwing") return [];
    const pointInitPos = pointInitPosOf(object);
    const boundMotors = motorsForObject(object, motors);
    if (pointInitPos.length === 0 || boundMotors.length === 0) return [];
    const xyTilt = controlType === "dualTiltFourPointSwing";
    const origins = originDistances(object);
    return [
      {
        objectId: object.id,
        pointInitPos,
        ...origins,
        maxHeight: object.motionParams.h?.maxAngle ?? 0,
        betaInit: xyTilt ? 0 : object.initialTiltDirection ?? 0,
        ...(xyTilt ? { xyTilt } : {}),
        motors: boundMotors,
      },
    ];
  });
