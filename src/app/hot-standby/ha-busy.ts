import type { HaStatusHolder } from "@shared/ha/protocol";
import type {
  ActionSequenceConfig,
  ControlledObjectConfig,
  MotorConfig,
} from "@/app/project/project-document-types";

/** 主进程拦指令用：另一台在用的设备（物体或电机，id 全局互斥） */
export type HaBusyEntry = { id: number; label: string; by: string };

/** 一条序列里用到的物体：位姿、指令块的物体，预设块的参与物体 */
export const sequenceObjectIds = (sequence: ActionSequenceConfig | undefined): number[] => {
  if (!sequence) return [];
  const ids = new Set<number>();
  for (const block of sequence.blocks) {
    if ("objectId" in block && typeof block.objectId === "number") ids.add(block.objectId);
    if ("orderedObjectIds" in block && Array.isArray(block.orderedObjectIds)) {
      for (const id of block.orderedObjectIds) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
};

const objectLabel = (object: Pick<ControlledObjectConfig, "id" | "name"> | undefined, id: number): string =>
  object?.name ? `物体「${object.name}」` : `物体 ${id}`;

/**
 * 另一台在用的 → 本机不能操作的设备（方案 6.4）：以物体为单位，
 * 物体在用时它的电机也算在用，电机在用时它所属的物体也算；没绑定物体的电机单独算。
 */
export const buildBusyEntries = (
  holders: readonly HaStatusHolder[],
  setup: { motors: readonly MotorConfig[]; controlledObjects: readonly ControlledObjectConfig[] } | null,
): HaBusyEntry[] => {
  const objects = new Map((setup?.controlledObjects ?? []).map((object) => [object.id, object]));
  const motors = new Map((setup?.motors ?? []).map((motor) => [motor.id, motor]));
  const motorsByObject = new Map<number, number[]>();
  for (const motor of setup?.motors ?? []) {
    if (motor.controlledObjectId === null) continue;
    const list = motorsByObject.get(motor.controlledObjectId) ?? [];
    list.push(motor.id);
    motorsByObject.set(motor.controlledObjectId, list);
  }
  const entries = new Map<number, HaBusyEntry>();
  const add = (id: number, label: string, by: string) => {
    if (!entries.has(id)) entries.set(id, { id, label, by });
  };
  for (const holder of holders) {
    for (const id of holder.deviceIds) {
      const objectId = objects.has(id) ? id : (motors.get(id)?.controlledObjectId ?? null);
      if (objectId === null) {
        add(id, `电机 ${id}`, holder.name);
        continue;
      }
      const label = objectLabel(objects.get(objectId), objectId);
      add(id, label, holder.name);
      add(objectId, label, holder.name);
      for (const motorId of motorsByObject.get(objectId) ?? []) add(motorId, label, holder.name);
    }
  }
  return [...entries.values()].sort((a, b) => a.id - b.id);
};

/** 另一台在运行的动作：本机不能改这些序列（和本机在运行的一样拦，方案 5.4） */
export const peerRunningSequenceIds = (holders: readonly HaStatusHolder[]): number[] =>
  [...new Set(holders.flatMap((holder) => holder.sequenceIds))].sort((a, b) => a - b);
