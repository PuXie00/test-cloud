import type {
  ControlledObject as TimelineControlledObject,
  ProgramNode,
} from "@/app/pages/console/components/action-builder/timeline/timeline-data";
import {
  isSequenceProgramItemRef,
  type ActionSequenceConfig,
  type ControlledObjectConfig,
  type MotorConfig,
  type ProjectMotion,
  type VirtualAxisId,
} from "./project-document-types";
import { CONTROL_TYPE_RULES } from "./configuration-rules";
import type { MotionAxisKind } from "./configuration-types";
import { decodeControlType } from "./control-type-code";
import { motionKindForVirtualAxis } from "./virtual-axis-mapping";
import { migrateActionSequenceProfiles } from "./action-sequence/migrate-motion-profiles";
import { resolveVirtualAxisMaxVelocity } from "./virtual-axis-max-velocity";

export const motionToProgramNodes = (motion: ProjectMotion): ProgramNode[] => {
  const seqById = new Map(motion.actionSequences.map((s) => [s.id, s]));

  return motion.programs.map((program) => ({
    id: program.id,
    name: program.name,
    type: "program" as const,
    children: program.chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      type: "chapter" as const,
      children: chapter.items.flatMap((item) => {
        if (!isSequenceProgramItemRef(item)) return [];
        const sequence = seqById.get(item.refId);
        return [
          {
            id: String(item.refId),
            name: sequence?.name ?? String(item.refId),
            type: "sequence" as const,
          },
        ];
      }),
    })),
  }));
};

const motionAxesFor = (controlType: ControlledObjectConfig["controlType"]) =>
  CONTROL_TYPE_RULES[decodeControlType(controlType)].motionAxes as readonly MotionAxisKind[];

export const setupObjectToTimelineObject = (
  object: ControlledObjectConfig,
  motors: readonly MotorConfig[] = [],
): TimelineControlledObject => {
  const maxSpeedByAxis = resolveVirtualAxisMaxVelocity(object, motors);
  const kinds = Object.keys(object.motionParams) as MotionAxisKind[];
  const minAccelTimeByAxis: Partial<Record<VirtualAxisId, number>> = {};
  const rangeByAxis: Partial<Record<VirtualAxisId, { min: number; max: number }>> = {};
  for (const axis of object.enabledVirtualAxes) {
    const kind = motionKindForVirtualAxis(kinds, axis);
    const params = object.motionParams[kind];
    if (!params) continue;
    minAccelTimeByAxis[axis] = params.minAccelTime;
    rangeByAxis[axis] = { min: params.minAngle, max: params.maxAngle };
  }
  const primaryIsRotation = motionAxesFor(object.controlType).includes("rotation");
  return {
    id: object.id,
    name: object.name,
    currentPosition: 0,
    unit: primaryIsRotation ? "°" : "m",
    axisLabel: "升降/旋转",
    enabled: true,
    enabledAxes: [...object.enabledVirtualAxes],
    rangeByAxis,
    maxSpeedByAxis,
    minAccelTimeByAxis,
    controlType: decodeControlType(object.controlType),
  };
};

export const setupNamesToTimelineObjects = (
  setupObjectNames: Record<number, string>,
): TimelineControlledObject[] =>
  Object.entries(setupObjectNames).map(([id, name]) => ({
    id: Number(id),
    name,
    currentPosition: 0,
    unit: "mm",
    axisLabel: "升降/旋转",
    enabled: true,
  }));

export const hydrateMotionForActionBuilder = (
  motion: ProjectMotion,
  setupObjectNames: Record<number, string>,
  setupObjects?: ControlledObjectConfig[],
  motors: readonly MotorConfig[] = [],
): {
  sequences: ActionSequenceConfig[];
  programs: ProgramNode[];
  timelineObjects: TimelineControlledObject[];
} => {
  const timelineObjects = setupObjects
    ? setupObjects.map((object) => setupObjectToTimelineObject(object, motors))
    : setupNamesToTimelineObjects(setupObjectNames);
  return {
    sequences: motion.actionSequences.map(migrateActionSequenceProfiles),
    programs: motionToProgramNodes(motion),
    timelineObjects,
  };
};
