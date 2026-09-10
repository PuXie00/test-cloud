import type { KinematicsErrorCode } from "@shared/kinematics/types";
import type {
  ControlledObject,
  Motor,
} from "../components/right-sidebar/config-wizard/config-wizard-types";
import type {
  ControlledObjectSnapshot,
  MotorMonitorSnapshot,
} from "../components/monitor-grid/monitor-data";
import {
  buildSolverCallItem,
  needsSolverExe,
  objectMotorsInAxisOrder,
  type SolverCallItem,
} from "./couple-kinematics-payload";
import type { CouplePreviewInputRow } from "./couple-preview";

export const KINEMATICS_ERROR_LABEL: Record<KinematicsErrorCode, string> = {
  EXE_NOT_FOUND: "未找到耦合反解程序",
  SPAWN_FAILED: "无法启动耦合反解程序",
  START_TIMEOUT: "耦合反解程序启动超时",
  SOLVE_TIMEOUT: "耦合计算超时",
  PROTOCOL_ERROR: "耦合反解通信失败",
  SOLVE_ERROR: "耦合反解失败",
  INVALID_RESULT: "耦合反解结果无效",
};

export type CouplePose = {
  objectId: number;
  hPosition: number;
  pPosition: number;
  yPosition: number;
};

export const motorPositionMap = (
  snapshots: readonly MotorMonitorSnapshot[],
): Map<number, number> =>
  new Map(snapshots.map((item) => [item.id, item.actualPosition ?? 0]));

export const objectHpy = (
  snapshot: ControlledObjectSnapshot | undefined,
): [number, number, number] => [
  snapshot?.positions?.h ?? 0,
  snapshot?.positions?.p ?? 0,
  snapshot?.positions?.y ?? 0,
];

const skipRowsForObject = (
  object: ControlledObject,
  motors: readonly Motor[],
  motorPositions: ReadonlyMap<number, number>,
): CouplePreviewInputRow[] =>
  objectMotorsInAxisOrder(object, motors).map((motor) => {
    const currentMm = motorPositions.get(motor.id) ?? 0;
    return {
      objectId: object.id,
      objectName: object.name,
      motorId: motor.id,
      currentMm,
      targetMm: currentMm,
    };
  });

export const prepareCoupleSolve = (input: {
  objects: readonly ControlledObject[];
  motors: readonly Motor[];
  motorPositions: ReadonlyMap<number, number>;
  hpyByObject: ReadonlyMap<number, [number, number, number]>;
}): {
  solverObjects: ControlledObject[];
  solverItems: SolverCallItem[];
  skipRows: CouplePreviewInputRow[];
  skipPoses: CouplePose[];
} => {
  const solverObjects: ControlledObject[] = [];
  const solverDraft: { objectId: number; payload: Omit<SolverCallItem, "index"> }[] = [];
  const skipRows: CouplePreviewInputRow[] = [];
  const skipPoses: CouplePose[] = [];

  for (const object of input.objects) {
    const hpy = input.hpyByObject.get(object.id) ?? [0, 0, 0];
    if (!needsSolverExe(object.controlType)) {
      skipRows.push(...skipRowsForObject(object, input.motors, input.motorPositions));
      skipPoses.push({
        objectId: object.id,
        hPosition: hpy[0],
        pPosition: hpy[1],
        yPosition: hpy[2],
      });
      continue;
    }
    solverObjects.push(object);
    solverDraft.push({
      objectId: object.id,
      payload: buildSolverCallItem({
        object,
        motors: input.motors,
        motorPositions: input.motorPositions,
        hpy,
        index: 0,
      }),
    });
  }

  const solverItems = solverDraft.map((entry, offset) => ({
    ...entry.payload,
    index: offset + 1,
  }));

  return { solverObjects, solverItems, skipRows, skipPoses };
};

export const previewRowsFromSolverResults = (input: {
  solverObjects: readonly ControlledObject[];
  motors: readonly Motor[];
  motorPositions: ReadonlyMap<number, number>;
  results: ReadonlyArray<{ index: number; HPY?: number[]; Motor_H?: number[] }>;
}): { rows: CouplePreviewInputRow[]; poses: CouplePose[] } => {
  const rows: CouplePreviewInputRow[] = [];
  const poses: CouplePose[] = [];
  for (let i = 0; i < input.solverObjects.length; i++) {
    const object = input.solverObjects[i]!;
    const result = input.results.find((item) => item.index === i + 1);
    const motors = objectMotorsInAxisOrder(object, input.motors);
    const motorH = result?.Motor_H ?? motors.map((motor) => input.motorPositions.get(motor.id) ?? 0);
    motors.forEach((motor, axisIndex) => {
      rows.push({
        objectId: object.id,
        objectName: object.name,
        motorId: motor.id,
        currentMm: input.motorPositions.get(motor.id) ?? 0,
        targetMm: motorH[axisIndex] ?? 0,
      });
    });
    const hpy = result?.HPY ?? [0, 0, 0];
    poses.push({
      objectId: object.id,
      hPosition: Number(hpy[0] ?? 0),
      pPosition: Number(hpy[1] ?? 0),
      yPosition: Number(hpy[2] ?? 0),
    });
  }
  return { rows, poses };
};

/** 计算超时时目标电机位置与虚轴 H/P/Y 均按 0 对照、下发 */
export const timeoutSolverPreview = (input: {
  solverObjects: readonly ControlledObject[];
  motors: readonly Motor[];
  motorPositions: ReadonlyMap<number, number>;
}): { rows: CouplePreviewInputRow[]; poses: CouplePose[] } =>
  previewRowsFromSolverResults({
    ...input,
    results: input.solverObjects.map((object, offset) => ({
      index: offset + 1,
      HPY: [0, 0, 0],
      Motor_H: objectMotorsInAxisOrder(object, input.motors).map(() => 0),
    })),
  });

export const toCoupleModelItems = (poses: readonly CouplePose[], coupleFlag: 0 | 1) =>
  poses.map((pose) =>
    coupleFlag === 0
      ? { deviceId: pose.objectId, coupleFlag }
      : {
          deviceId: pose.objectId,
          coupleFlag,
          hPosition: pose.hPosition,
          pPosition: pose.pPosition,
          yPosition: pose.yPosition,
        },
  );

export const orderCouplePreview = (
  objectIds: readonly number[],
  rows: readonly CouplePreviewInputRow[],
  poses: readonly CouplePose[],
): { rows: CouplePreviewInputRow[]; poses: CouplePose[] } => {
  const rowsByObject = new Map<number, CouplePreviewInputRow[]>();
  for (const row of rows) {
    const list = rowsByObject.get(row.objectId) ?? [];
    list.push(row);
    rowsByObject.set(row.objectId, list);
  }
  const poseByObject = new Map(poses.map((pose) => [pose.objectId, pose]));
  return {
    rows: objectIds.flatMap((id) => rowsByObject.get(id) ?? []),
    poses: objectIds.flatMap((id) => {
      const pose = poseByObject.get(id);
      return pose ? [pose] : [];
    }),
  };
};
