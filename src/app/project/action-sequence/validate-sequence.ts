import {
  collectAngleProtectionHits,
  type AngleProtectionObject,
} from "@/app/kinematics/angle-protection";
import { collectMotorOverspeedHits } from "@/app/kinematics/motor-overspeed";
import type { MotorOverspeedObject } from "@/app/kinematics/motor-overspeed";
import { getPresetDefinition } from "./preset-registry";
import {
  isInstructionPresetId,
  validateInstructionInstr,
} from "./instruction-registry";
import { isAxisSet } from "./keyframe-pose";
import {
  resolveActionSequence,
  segmentAxisMotion,
  isPassThroughMotion,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
  type ResolvedMotionSegment,
} from "./resolve-sequence";
import { axisMotionShape } from "./axis-motion";
import {
  boundaryTrapezoidKinematics,
  calculateMotionProfileKinematics,
  hasMotionBoundary,
  validateMotionProfile,
  type MotionProfileKinematics,
} from "./motion-profile";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  DynamicPresetBlock,
  ModelPose,
  StaticPresetBlock,
  TimelineBlock,
} from "./types";

export const LONG_IDLE_MS = 10_000;

export type SequenceIssueSeverity = "error" | "warning";
export type SequenceIssueCode =
  | "missing-object"
  | "invalid-preset"
  | "invalid-time"
  | "invalid-trajectory-mode"
  | "duplicate-pose-time"
  | "motion-overlap"
  | "invalid-dynamic-range"
  | "limit-exceeded"
  | "command-conflict"
  | "unknown-instruction"
  | "invalid-instruction"
  | "unresolved-segment"
  | "boundary-discontinuity"
  | "long-idle"
  | "invalid-motion-profile"
  | "missing-motion-limit"
  | "acceleration-exceeded"
  | "insufficient-cruise"
  | "idle-on-moving-axis"
  | "motor-overspeed"
  | "angle-protection"
  | "unset-axis"
  | "pass-speed-infeasible";

export type SequenceIssue = {
  severity: SequenceIssueSeverity;
  code: SequenceIssueCode;
  message: string;
  blockId?: string;
  objectId?: number;
  segmentKey?: string;
  /** 问题曲线跨过多个运动区间时，全部区间的 key（含 segmentKey） */
  segmentKeys?: readonly string[];
  atMs?: number;
  suggestedDurationMs?: number;
};

export type VirtualAxisId = "v1" | "v2" | "v3";

export type AxisLimit = {
  min: number;
  max: number;
  maxVelocity?: number;
  minAccelTime?: number;
};

export type SequenceValidationContext = {
  objects: Array<{
    id: number;
    enabledVirtualAxes: VirtualAxisId[];
    limits: Partial<Record<VirtualAxisId, AxisLimit>>;
    safetyRadius?: number;
  }>;
  hoistObjects?: MotorOverspeedObject[];
};

type MotionSpan =
  | { kind: "point"; objectId: number; atMs: number; blockId: string }
  | { kind: "range"; objectId: number; startMs: number; endMs: number; blockId: string };

type ObjectInfo = SequenceValidationContext["objects"][number];

const uniqueIds = (ids: number[]): number[] => [...new Set(ids)];

const objectByIdMap = (context: SequenceValidationContext): Map<number, ObjectInfo> =>
  new Map(context.objects.map((object) => [object.id, object]));

const angleProtectObjectsOf = (context: SequenceValidationContext): AngleProtectionObject[] =>
  context.objects.flatMap((object) => {
    if (!(typeof object.safetyRadius === "number" && object.safetyRadius > 0)) return [];
    if (!object.enabledVirtualAxes.includes("v1") || !object.enabledVirtualAxes.includes("v2")) {
      return [];
    }
    const height = object.limits.v1;
    const pitch = object.limits.v2;
    if (!height || !pitch) return [];
    return [
      {
        objectId: object.id,
        radius: object.safetyRadius,
        minHeight: height.min,
        maxHeight: height.max,
        minPitch: pitch.min,
        maxPitch: pitch.max,
      },
    ];
  });

const enabledAxesOf = (object: ObjectInfo | undefined): VirtualAxisId[] =>
  object?.enabledVirtualAxes ?? [];

const posesEqualOn = (left: ModelPose, right: ModelPose, axes: VirtualAxisId[]): boolean =>
  axes.every((axis) => left[axis] === right[axis]);

const referencedObjectIds = (sequence: ActionSequenceConfig): Set<number> => {
  const ids = new Set<number>();
  for (const block of sequence.blocks) {
    if (block.kind === "pose" || block.kind === "instruction") {
      ids.add(block.objectId);
      continue;
    }
    for (const objectId of block.orderedObjectIds) ids.add(objectId);
  }
  return ids;
};

const isValidAuthoredTime = (value: number): boolean => Number.isFinite(value) && value >= 0;

const authoredTimesOf = (block: TimelineBlock): number[] => {
  if (block.kind === "dynamic-preset") return [block.startMs, block.endMs];
  return [block.atMs];
};

const pushPresetError = (issues: SequenceIssue[], blockId: string, message: string): void => {
  issues.push({
    severity: "error",
    code: "invalid-preset",
    message,
    blockId,
  });
};

const validatePresetBlock = (
  block: StaticPresetBlock | DynamicPresetBlock,
  issues: SequenceIssue[],
): void => {
  const definition = getPresetDefinition(block.presetId);
  if (!definition) {
    pushPresetError(issues, block.id, `unavailable preset definition ${block.presetId}`);
    return;
  }
  const expectedKind = definition.kind === "static" ? "static-preset" : "dynamic-preset";
  if (block.kind !== expectedKind) {
    pushPresetError(
      issues,
      block.id,
      `preset ${block.presetId} kind is ${definition.kind} but block kind is ${block.kind}`,
    );
  }
  const seen = new Set<number>();
  for (const objectId of block.orderedObjectIds) {
    if (seen.has(objectId)) {
      pushPresetError(issues, block.id, "duplicate preset participants");
      break;
    }
    seen.add(objectId);
  }
  if (block.orderedObjectIds.length < definition.minObjects) {
    pushPresetError(issues, block.id, `preset requires at least ${definition.minObjects} objects`);
  }
  if (definition.maxObjects !== undefined && block.orderedObjectIds.length > definition.maxObjects) {
    pushPresetError(issues, block.id, `preset allows at most ${definition.maxObjects} objects`);
  }
  const paramErrors = definition.validateParams(block.params);
  if (paramErrors.length > 0) {
    pushPresetError(issues, block.id, paramErrors.join("; "));
  }
  if (block.kind === "dynamic-preset" && block.endMs <= block.startMs) {
    issues.push({
      severity: "error",
      code: "invalid-dynamic-range",
      message: "dynamic preset endMs must be greater than startMs",
      blockId: block.id,
    });
  }
};

const motionSpans = (sequence: ActionSequenceConfig): MotionSpan[] => {
  const spans: MotionSpan[] = [];
  for (const block of sequence.blocks) {
    if (block.kind === "pose") {
      spans.push({ kind: "point", objectId: block.objectId, atMs: block.atMs, blockId: block.id });
      continue;
    }
    if (block.kind === "static-preset") {
      for (const objectId of uniqueIds(block.orderedObjectIds)) {
        spans.push({ kind: "point", objectId, atMs: block.atMs, blockId: block.id });
      }
      continue;
    }
    if (block.kind === "dynamic-preset") {
      for (const objectId of uniqueIds(block.orderedObjectIds)) {
        spans.push({
          kind: "range",
          objectId,
          startMs: block.startMs,
          endMs: block.endMs,
          blockId: block.id,
        });
      }
    }
  }
  return spans;
};

const spansOverlap = (left: MotionSpan, right: MotionSpan): boolean => {
  if (left.kind === "range" && right.kind === "range") {
    return Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs);
  }
  if (left.kind === "point" && right.kind === "range") {
    return right.startMs < left.atMs && left.atMs < right.endMs;
  }
  if (left.kind === "range" && right.kind === "point") {
    return left.startMs < right.atMs && right.atMs < left.endMs;
  }
  return false;
};

const collectAuthoredIssues = (
  sequence: ActionSequenceConfig,
  context: SequenceValidationContext,
  issues: SequenceIssue[],
): void => {
  const objectById = objectByIdMap(context);

  if (typeof sequence.trajectoryMode !== "boolean") {
    issues.push({
      severity: "error",
      code: "invalid-trajectory-mode",
      message: "trajectoryMode must be boolean",
    });
  }

  for (const objectId of referencedObjectIds(sequence)) {
    if (objectById.has(objectId)) continue;
    issues.push({
      severity: "error",
      code: "missing-object",
      message: `unknown object ${objectId}`,
      objectId,
    });
  }

  for (const block of sequence.blocks) {
    for (const value of authoredTimesOf(block)) {
      if (isValidAuthoredTime(value)) continue;
      issues.push({
        severity: "error",
        code: "invalid-time",
        message: "time must be a finite number >= 0",
        blockId: block.id,
        ...("objectId" in block ? { objectId: block.objectId } : {}),
      });
    }
    if (block.kind === "static-preset" || block.kind === "dynamic-preset") {
      validatePresetBlock(block, issues);
    }
    if (block.kind === "pose") {
      const object = objectById.get(block.objectId);
      const axes = object?.enabledVirtualAxes ?? (["v1", "v2", "v3"] as const);
      if (!axes.some((axis) => isAxisSet(block.pose, axis))) {
        issues.push({
          severity: "error",
          code: "unset-axis",
          message: "pose has no axis set",
          blockId: block.id,
          objectId: block.objectId,
        });
      }
    }
    if (block.kind === "instruction") {
      if (!isInstructionPresetId(block.presetId)) {
        issues.push({
          severity: "error",
          code: "unknown-instruction",
          message: `unknown instruction ${block.presetId}`,
          blockId: block.id,
          objectId: block.objectId,
        });
      } else {
        const instrErrors = validateInstructionInstr(block.presetId, block.instr);
        if (instrErrors.length > 0) {
          issues.push({
            severity: "error",
            code: "invalid-instruction",
            message: instrErrors.join("; "),
            blockId: block.id,
            objectId: block.objectId,
          });
        }
      }
    }
  }

  for (const item of sequence.segments) {
    const errors = profileErrorsOfProfiles(item.settings.profiles);
    if (errors.length === 0) continue;
    issues.push({
      severity: "error",
      code: "invalid-motion-profile",
      message: `invalid motion profile on segment ${item.fromRef} -> ${item.toRef}: ${errors.join("; ")}`,
    });
  }

  for (const block of sequence.blocks) {
    if (block.kind !== "dynamic-preset") continue;
    const errors = profileErrorsOfProfiles(block.profiles);
    if (errors.length === 0) continue;
    issues.push({
      severity: "error",
      code: "invalid-motion-profile",
      message: `invalid motion profile on dynamic preset ${block.id}: ${errors.join("; ")}`,
      blockId: block.id,
    });
  }

  const byObject = new Map<number, MotionSpan[]>();
  for (const span of motionSpans(sequence)) {
    const list = byObject.get(span.objectId);
    if (list) list.push(span);
    else byObject.set(span.objectId, [span]);
  }
  for (const [objectId, spans] of byObject) {
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const left = spans[i];
        const right = spans[j];
        if (left === undefined || right === undefined || !spansOverlap(left, right)) continue;
        issues.push({
          severity: "error",
          code: "motion-overlap",
          message: `overlapping motion sources for object ${objectId}`,
          objectId,
          blockId: left.blockId,
        });
      }
    }
  }

  const commands = sequence.blocks.filter(
    (block): block is Extract<TimelineBlock, { kind: "instruction" }> =>
      block.kind === "instruction",
  );
  const grouped = new Map<string, typeof commands>();
  for (const block of commands) {
    const key = `${block.objectId}:${block.atMs}`;
    const list = grouped.get(key);
    if (list) list.push(block);
    else grouped.set(key, [block]);
  }
  for (const group of grouped.values()) {
    const hasEnable = group.some(
      (block) => block.presetId === "set-enabled" && block.instr.enabled,
    );
    const hasDisable = group.some(
      (block) => block.presetId === "set-enabled" && !block.instr.enabled,
    );
    if (!hasEnable || !hasDisable) continue;
    const first = group[0];
    if (first === undefined) continue;
    issues.push({
      severity: "error",
      code: "command-conflict",
      message: `contradictory enable/disable at ${first.atMs}ms`,
      objectId: first.objectId,
      blockId: first.id,
    });
  }
};

const checkPoseLimits = (
  objectId: number,
  pose: ModelPose,
  objectById: Map<number, ObjectInfo>,
  issues: SequenceIssue[],
  blockId?: string | null,
  /** 序列不控制的轴只有占位值，不查 */
  skipAxes: readonly VirtualAxisId[] = [],
): void => {
  const object = objectById.get(objectId);
  if (!object) return;
  for (const axis of object.enabledVirtualAxes) {
    if (skipAxes.includes(axis)) continue;
    const limit = object.limits[axis];
    if (!limit) continue;
    const value = pose[axis];
    if (value >= limit.min && value <= limit.max) continue;
    issues.push({
      severity: "error",
      code: "limit-exceeded",
      message: `axis ${axis} position ${value} outside [${limit.min}, ${limit.max}]`,
      objectId,
      ...(blockId ? { blockId } : {}),
    });
  }
};

const isPositiveFinite = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const profileErrorsOfProfiles = (profiles: AxisMotionProfiles | undefined): string[] => {
  if (profiles == null) return ["motion profiles are required"];
  const errors: string[] = [];
  for (const axis of ["v1", "v2", "v3"] as const) {
    const axisErrors = validateMotionProfile(profiles[axis]);
    if (axisErrors.length === 0) continue;
    errors.push(`axis ${axis}: ${axisErrors.join("; ")}`);
  }
  return errors;
};

const checkSegmentKinematics = (
  object: ObjectInfo,
  segment: ResolvedMotionSegment,
  checked: Set<string>,
  issues: SequenceIssue[],
): void => {
  const blockId = segment.ownerPresetBlockId;
  for (const axis of object.enabledVirtualAxes) {
    const motion = segmentAxisMotion(segment, axis);
    // 轴跨过中间位姿时几个区间共用一条曲线，只查一次
    const motionKey = `${object.id}:${axis}:${motion.fromRef}->${motion.toRef}`;
    if (checked.has(motionKey)) continue;
    checked.add(motionKey);
    const durationMs = motion.durationMs;
    if (durationMs <= 0) continue;
    const travel = Math.abs(motion.to - motion.from);
    if (travel === 0) continue;

    const profile = motion.profile;
    const location = {
      segmentKey: motion.segmentKeys[0] ?? segment.key,
      ...(motion.segmentKeys.length > 1 ? { segmentKeys: motion.segmentKeys } : {}),
      objectId: object.id,
      ...(blockId ? { blockId } : {}),
    };
    if (profile.kind === "idle") {
      issues.push({
        severity: "error",
        code: "idle-on-moving-axis",
        message: `axis ${axis} is idle but has travel on segment ${motion.fromRef} -> ${motion.toRef}`,
        ...location,
      });
      continue;
    }
    if (validateMotionProfile(profile).length > 0) continue;

    const limit = object.limits[axis];
    const maxVelocity = limit?.maxVelocity;
    const minAccelTime = limit?.minAccelTime;
    if (!isPositiveFinite(maxVelocity) || !isPositiveFinite(minAccelTime)) {
      issues.push({
        severity: "error",
        code: "missing-motion-limit",
        message: `axis ${axis} is missing a positive finite maxVelocity or minAccelTime`,
        ...location,
      });
      continue;
    }

    const { accelMs, decelMs } = profile.params;
    if (accelMs + decelMs >= durationMs) {
      issues.push({
        severity: "error",
        code: "insufficient-cruise",
        message: `axis ${axis} has insufficient cruise time for accel and decel phases on segment ${motion.fromRef} -> ${motion.toRef}`,
        ...location,
      });
      continue;
    }

    let metrics: MotionProfileKinematics;
    if (hasMotionBoundary(motion)) {
      const shape = axisMotionShape(motion);
      if (!shape) {
        issues.push({
          severity: "error",
          code: "pass-speed-infeasible",
          message: `axis ${axis} cannot fit pass speeds ${motion.startSpeed} -> ${motion.endSpeed} on segment ${motion.fromRef} -> ${motion.toRef}`,
          ...location,
        });
        continue;
      }
      metrics = boundaryTrapezoidKinematics(shape);
    } else {
      metrics = calculateMotionProfileKinematics(profile, travel, durationMs);
    }
    if (metrics.peakVelocity > maxVelocity) {
      issues.push({
        severity: "error",
        code: "limit-exceeded",
        message: `axis ${axis} velocity ${metrics.peakVelocity} exceeds ${maxVelocity}`,
        ...location,
      });
    }
    // 加减速度上限 = 虚轴最大速度 / 最短加减速时间，和下发 PLC 的最大加速度一致
    const maxAcceleration = maxVelocity / minAccelTime;
    const acceleration = Math.max(metrics.acceleration, metrics.deceleration);
    if (acceleration > maxAcceleration * (1 + 1e-9)) {
      issues.push({
        severity: "error",
        code: "acceleration-exceeded",
        message: `axis ${axis} acceleration ${acceleration} exceeds ${maxAcceleration}`,
        ...location,
      });
    }
  }
};

const collectResolvedIssues = (
  sequence: ActionSequenceConfig,
  context: SequenceValidationContext,
  resolved: ResolvedActionSequence,
  issues: SequenceIssue[],
): void => {
  const objectById = objectByIdMap(context);

  for (const [objectId, poses] of resolved.posesByObject) {
    for (let index = 0; index < poses.length - 1; index += 1) {
      const current = poses[index];
      const next = poses[index + 1];
      if (current === undefined || next === undefined) continue;
      if (current.atMs !== next.atMs) continue;
      issues.push({
        severity: "error",
        code: "duplicate-pose-time",
        message: `duplicate motion poses at ${current.atMs}ms`,
        objectId,
        ...(current.sourceBlockId ? { blockId: current.sourceBlockId } : {}),
      });
    }
  }

  for (const point of resolved.poses) {
    checkPoseLimits(
      point.objectId,
      point.pose,
      objectById,
      issues,
      point.sourceBlockId,
      uncontrolledAxesOf(resolved, point.objectId),
    );
  }

  const derivedConfigurable = new Set<string>();
  for (const segment of resolved.segments) {
    if (!segment.configurable) continue;
    derivedConfigurable.add(`${segment.fromRef}=>${segment.toRef}`);
    for (const axis of ["v1", "v2", "v3"] as const) {
      const motion = segmentAxisMotion(segment, axis);
      if (motion.configurable && isPassThroughMotion(segment, motion)) {
        derivedConfigurable.add(`${motion.fromRef}=>${motion.toRef}`);
      }
    }
  }
  for (const item of sequence.segments) {
    if (derivedConfigurable.has(`${item.fromRef}=>${item.toRef}`)) continue;
    issues.push({
      severity: "error",
      code: "unresolved-segment",
      message: `unresolved segment ${item.fromRef} -> ${item.toRef}`,
    });
  }

  const checkedMotions = new Set<string>();
  for (const segment of resolved.segments) {
    const object = objectById.get(segment.objectId);
    if (!object) continue;
    const axes = enabledAxesOf(object);
    checkSegmentKinematics(object, segment, checkedMotions, issues);

    if (segment.durationMs >= LONG_IDLE_MS && posesEqualOn(segment.fromPose, segment.toPose, axes)) {
      issues.push({
        severity: "warning",
        code: "long-idle",
        message: `idle period of ${segment.durationMs}ms`,
        objectId: segment.objectId,
      });
    }
  }

  if (context.hoistObjects && context.hoistObjects.length > 0) {
    for (const hit of collectMotorOverspeedHits(context.hoistObjects, resolved.segments)) {
      issues.push({
        severity: "error",
        code: "motor-overspeed",
        message: hit.message,
        objectId: hit.objectId,
        segmentKey: hit.segmentKey,
        atMs: hit.atMs,
        suggestedDurationMs: hit.suggestedDurationMs,
      });
    }
  }

  for (const hit of collectAngleProtectionHits(
    angleProtectObjectsOf(context),
    resolved.segments,
    resolved.poses,
  )) {
    issues.push({
      severity: "error",
      code: "angle-protection",
      message: hit.message,
      objectId: hit.objectId,
      atMs: hit.atMs,
      ...(hit.segmentKey ? { segmentKey: hit.segmentKey } : {}),
      ...(hit.blockId ? { blockId: hit.blockId } : {}),
    });
  }

  for (const [objectId, series] of resolved.posesByObject) {
    const object = objectById.get(objectId);
    const axes = enabledAxesOf(object);
    for (let index = 0; index < series.length - 1; index += 1) {
      const from = series[index];
      const to = series[index + 1];
      if (from === undefined || to === undefined) continue;
      if (posesEqualOn(from.pose, to.pose, axes)) continue;
      const crossesDynamicBoundary =
        from.atMs === to.atMs &&
        (from.sourceKind === "dynamic-preset" || to.sourceKind === "dynamic-preset") &&
        from.sourceBlockId !== to.sourceBlockId;
      const jumpsFromWaveHoldStart =
        from.visible === false &&
        to.visible === true &&
        from.sourceKind === "dynamic-preset" &&
        to.sourceKind === "dynamic-preset" &&
        from.sourceBlockId !== null &&
        from.sourceBlockId === to.sourceBlockId &&
        from.sourceRef.endsWith(":hold-start");
      if (!crossesDynamicBoundary && !jumpsFromWaveHoldStart) continue;
      issues.push({
        severity: "warning",
        code: "boundary-discontinuity",
        message: `dynamic preset boundary discontinuity at ${to.atMs}ms`,
        objectId,
        atMs: to.atMs,
        ...(to.sourceBlockId ? { blockId: to.sourceBlockId } : {}),
      });
    }
  }
};

export const hasBlockingSequenceIssues = (issues: SequenceIssue[]): boolean =>
  issues.some((issue) => issue.severity === "error");

export type InvalidTimelineTargets = {
  blockIds: ReadonlySet<string>;
  segmentKeys: ReadonlySet<string>;
  blockMessage: ReadonlyMap<string, string>;
  segmentMessage: ReadonlyMap<string, string>;
};

export const invalidTimelineTargets = (
  issues: readonly SequenceIssue[] | undefined,
): InvalidTimelineTargets => {
  const blockIds = new Set<string>();
  const segmentKeys = new Set<string>();
  const blockMessage = new Map<string, string>();
  const segmentMessage = new Map<string, string>();
  for (const issue of issues ?? []) {
    if (issue.severity !== "error") continue;
    if (issue.blockId) {
      blockIds.add(issue.blockId);
      if (!blockMessage.has(issue.blockId)) blockMessage.set(issue.blockId, issue.message);
    }
    for (const key of issue.segmentKeys ?? (issue.segmentKey ? [issue.segmentKey] : [])) {
      segmentKeys.add(key);
      if (!segmentMessage.has(key)) segmentMessage.set(key, issue.message);
    }
  }
  return { blockIds, segmentKeys, blockMessage, segmentMessage };
};

export const validateActionSequence = (
  sequence: ActionSequenceConfig,
  context: SequenceValidationContext,
): SequenceIssue[] => {
  const issues: SequenceIssue[] = [];
  try {
    collectAuthoredIssues(sequence, context, issues);
    try {
      const resolved = resolveActionSequence(sequence);
      collectResolvedIssues(sequence, context, resolved, issues);
    } catch (error) {
      const alreadyReported = issues.some(
        (issue) =>
          issue.code === "invalid-preset"
          || issue.code === "invalid-dynamic-range"
          || issue.code === "invalid-motion-profile",
      );
      if (!alreadyReported) {
        issues.push({
          severity: "error",
          code: "invalid-preset",
          message: error instanceof Error ? error.message : "failed to resolve sequence",
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: "error",
      code: "invalid-preset",
      message: error instanceof Error ? error.message : "sequence validation failed",
    });
  }
  return issues;
};
