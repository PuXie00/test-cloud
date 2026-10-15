import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import { instructionBlockTitle } from "@/app/project/action-sequence/instruction-registry";
import { isAxisSet, withoutAxis } from "@/app/project/action-sequence/keyframe-pose";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { formatRepairItems } from "@/app/project/action-sequence/preset-repair";
import {
  isPassThroughMotion,
  segmentAxisMotion,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  AxisMotionProfiles,
  KeyframePose,
  ModelPose,
  MotionSegmentSettings,
  PoseBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import {
  MotionProfileEditor,
  type MotionProfileAxisContext,
} from "../motion-profile/motion-profile-editor";
import {
  motionProfileSegmentStatus,
  resolveEnabledAxes,
} from "../motion-profile/motion-profile-status";
import { EmptySelectionState } from "./empty-selection-state";
import { PresetBlockFields, presetBlockTitle } from "./preset-block-panel";
import { RepairBand } from "./repair-band";
import { lookupSequenceSelection, type SequenceSelection } from "../sequence-selection";
import type { PoseAxisWrite } from "../sequence-ops";
import {
  VIRTUAL_AXIS_IDS,
  formatDurationSeconds,
  formatTime,
  msToSeconds,
  secondsToMs,
  type ControlledObject,
} from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import {
  AXIS_MODE_TABS,
  intersectAxisRange,
  virtualAxisLabel,
  type AxisEditMode,
} from "../virtual-axis-edit";
import { VirtualAxisRow } from "../virtual-axis-row";
import type { VirtualAxisId } from "@/app/project/project-document-types";

export type SequencePropertiesPanelProps = {
  sequence: ActionSequenceConfig;
  resolved: ResolvedActionSequence;
  selection: SequenceSelection;
  onReplaceBlock: (block: TimelineBlock) => void;
  onUpdateSegment: (
    fromRef: string,
    toRef: string,
    settings: MotionSegmentSettings,
  ) => void;
  onDeleteBlock: (blockId: string | string[]) => void;
};

const PropertiesShell = ({
  title,
  children,
  onDelete,
  plain = false,
  headerStatus,
}: {
  title: string;
  children: ReactNode;
  onDelete?: () => void;
  plain?: boolean;
  headerStatus?: ReactNode;
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 bg-muted px-3">
      <h2 className="truncate text-label-caps text-foreground">{title}</h2>
      {headerStatus}
    </div>
    <div
      className={cn(
        "custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-background",
        plain ? "p-2" : "p-4",
      )}
    >
      <div className={cn(!plain && "rounded-md bg-muted p-4")}>
        {children}
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-md bg-destructive text-body-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </button>
        ) : null}
      </div>
    </div>
  </div>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mb-3">
    <p className="mb-1 text-body-sm text-muted-foreground">{label}</p>
    {children}
  </div>
);

const ZERO_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const poseSelectionKey = (poses: readonly PoseBlock[]): string =>
  poses.map((block) => `${block.id}:${block.pose.v1},${block.pose.v2},${block.pose.v3}`).join("|");

const axisContextFromObject = (
  object: ControlledObject | undefined,
  travel: ModelPose,
  durationMs: number,
): MotionProfileAxisContext => ({
  enabledAxes: object?.enabledAxes?.length ? object.enabledAxes : VIRTUAL_AXIS_IDS,
  travel,
  durationMs,
  controlType: object?.controlType,
  maxSpeedByAxis: object?.maxSpeedByAxis,
  minAccelTimeByAxis: object?.minAccelTimeByAxis,
});

const PoseAxesEditor = ({
  pose,
  passThrough,
  uncontrolledAxes,
  objectId,
  onChange,
}: {
  pose: KeyframePose;
  /** 解析后的位姿：不设定的轴取这一帧的经过值 */
  passThrough: ModelPose | undefined;
  /** 该物体在所有位姿上都不设定的轴：序列不控制，没有经过值 */
  uncontrolledAxes: readonly VirtualAxisId[];
  objectId: number;
  onChange: (pose: KeyframePose) => void;
}) => {
  const { getTimelineObject, getLivePose } = useActionBuilder();
  const object = getTimelineObject(objectId);
  const [mode, setMode] = useState<AxisEditMode>("abs");
  const shown: ModelPose = {
    v1: pose.v1 ?? passThrough?.v1 ?? 0,
    v2: pose.v2 ?? passThrough?.v2 ?? 0,
    v3: pose.v3 ?? passThrough?.v3 ?? 0,
  };
  const [drafts, setDrafts] = useState<ModelPose>(shown);

  useEffect(() => {
    setDrafts(mode === "rel" ? ZERO_POSE : { v1: shown.v1, v2: shown.v2, v3: shown.v3 });
  }, [mode, shown.v1, shown.v2, shown.v3]);

  const handleModeChange = (next: AxisEditMode) => {
    setMode(next);
  };

  const enabledAxes = resolveEnabledAxes(object?.enabledAxes ?? []);
  const setCount = enabledAxes.filter((axis) => isAxisSet(pose, axis)).length;

  const handleDraftChange = (axis: VirtualAxisId, value: number) => {
    setDrafts((current) => ({ ...current, [axis]: value }));
  };

  const handleCommit = (axis: VirtualAxisId, value: number) => {
    const current = pose[axis];
    if (current === undefined) return;
    const range = object?.rangeByAxis?.[axis];
    const nextValue = mode === "rel" ? current + value : value;
    const clamped = clampNumeric(nextValue, range?.min, range?.max);
    setDrafts((drafts) => ({
      ...drafts,
      [axis]: mode === "rel" ? 0 : clamped,
    }));
    if (clamped === current) return;
    onChange({ ...pose, [axis]: clamped });
  };

  const handleTogglePassThrough = (axis: VirtualAxisId) => {
    if (isAxisSet(pose, axis)) {
      if (setCount <= 1) return;
      onChange(withoutAxis(pose, axis));
      return;
    }
    // 重新设定时取这一帧的经过值，轨迹位置不跳；序列原本不控制的轴取实时位置
    const value = uncontrolledAxes.includes(axis)
      ? (getLivePose?.(objectId)?.[axis] ?? shown[axis])
      : shown[axis];
    onChange({ ...pose, [axis]: roundProjectCoordinate(value) });
  };
  const passingAxes = enabledAxes.filter(
    (axis) => !isAxisSet(pose, axis) && !uncontrolledAxes.includes(axis),
  );
  const freeAxes = enabledAxes.filter((axis) => uncontrolledAxes.includes(axis));

  return (
    <div className="mb-3 space-y-2">
      <div className="flex justify-center">
        <TabBar
          tabs={AXIS_MODE_TABS}
          active={mode}
          onChange={handleModeChange}
          className="h-7 w-44 border-b-0 bg-transparent"
        />
      </div>
      {enabledAxes.map((axis) => {
        const range = object?.rangeByAxis?.[axis];
        const passing = !isAxisSet(pose, axis);
        const onlySet = !passing && setCount <= 1;
        return (
          <div key={axis} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <VirtualAxisRow
                axis={axis}
                value={drafts[axis]}
                mixed={uncontrolledAxes.includes(axis)}
                unit={getVirtualAxisCanonicalUnit(axis, object?.controlType)}
                min={mode === "abs" ? range?.min : undefined}
                max={mode === "abs" ? range?.max : undefined}
                disabled={passing}
                onChange={(value) => handleDraftChange(axis, value)}
                onCommit={(value) => handleCommit(axis, value)}
              />
            </div>
            <button
              type="button"
              aria-label={`${virtualAxisLabel(axis)} 经过`}
              aria-pressed={passing}
              disabled={onlySet}
              title={onlySet ? "至少设定一个轴" : "不设定：这一帧不停，按前后设定值之间的曲线经过"}
              onClick={() => handleTogglePassThrough(axis)}
              className={cn(
                "h-8 shrink-0 rounded-md px-2 text-body-sm disabled:cursor-not-allowed disabled:opacity-50",
                passing
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "border border-border text-foreground hover:bg-accent",
              )}
            >
              经过
            </button>
          </div>
        );
      })}
      {passingAxes.length > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          经过的轴这一帧不停，显示的是按前后设定值算出的位置
        </p>
      ) : null}
      {freeAxes.length > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          {freeAxes.map(virtualAxisLabel).join("、")} 在所有位姿上都不设定，这条序列不控制它，停在原位
        </p>
      ) : null}
    </div>
  );
};

const MultiPoseAxesEditor = ({ poses }: { poses: PoseBlock[] }) => {
  const { getTimelineObject, handleApplyPoseAxisWrite } = useActionBuilder();
  const [mode, setMode] = useState<AxisEditMode>("abs");
  const [relDrafts, setRelDrafts] = useState<ModelPose>(ZERO_POSE);
  const [absDrafts, setAbsDrafts] = useState<Partial<ModelPose>>({});

  const participants = poses.map((block) => {
    const object = getTimelineObject(block.objectId);
    return {
      block,
      object,
      enabledAxes: resolveEnabledAxes(object?.enabledAxes ?? []),
    };
  });
  const unionAxes = VIRTUAL_AXIS_IDS.filter((axis) =>
    participants.some((item) => item.enabledAxes.includes(axis)),
  );
  const blockIds = poses.map((block) => block.id);
  const selectionKey = poseSelectionKey(poses);
  const posesRef = useRef(poses);
  posesRef.current = poses;

  useEffect(() => {
    const currentPoses = posesRef.current;
    if (mode === "rel") {
      setRelDrafts(ZERO_POSE);
      return;
    }
    const next: Partial<ModelPose> = {};
    for (const axis of VIRTUAL_AXIS_IDS) {
      const values = currentPoses
        .filter((block) => {
          const object = getTimelineObject(block.objectId);
          return resolveEnabledAxes(object?.enabledAxes ?? []).includes(axis);
        })
        .map((block) => block.pose[axis]);
      const shared = values[0];
      if (shared !== undefined && values.every((value) => value === shared)) {
        next[axis] = shared;
      }
    }
    setAbsDrafts(next);
  }, [getTimelineObject, mode, selectionKey]);

  const handleModeChange = (next: AxisEditMode) => {
    setMode(next);
  };

  const handleApply = (axis: VirtualAxisId, value: number) => {
    const write: PoseAxisWrite = { mode, axis, value };
    if (mode === "rel") {
      setRelDrafts((current) => ({ ...current, [axis]: 0 }));
    } else {
      setAbsDrafts((current) => ({ ...current, [axis]: value }));
    }
    handleApplyPoseAxisWrite(blockIds, write);
  };

  return (
    <div className="mb-3 space-y-2">
      <div className="flex justify-center">
        <TabBar
          tabs={AXIS_MODE_TABS}
          active={mode}
          onChange={handleModeChange}
          className="h-7 w-44 border-b-0 bg-transparent"
        />
      </div>
      {unionAxes.map((axis) => {
        const writable = participants.filter((item) => item.enabledAxes.includes(axis));
        const values = writable.map((item) => item.block.pose[axis]);
        const shared = values[0];
        const mixed =
          mode === "abs" &&
          (shared === undefined || values.some((value) => value !== shared)) &&
          absDrafts[axis] === undefined;
        const units = writable.map((item) =>
          getVirtualAxisCanonicalUnit(axis, item.object?.controlType),
        );
        const unit =
          units[0] !== undefined && units.every((item) => item === units[0]) ? units[0] : undefined;
        const range = intersectAxisRange(
          writable.flatMap((item) => {
            const next = item.object?.rangeByAxis?.[axis];
            return next === undefined ? [] : [next];
          }),
        );
        const value =
          mode === "rel" ? relDrafts[axis] : (absDrafts[axis] ?? shared ?? 0);
        return (
          <VirtualAxisRow
            key={axis}
            axis={axis}
            value={value}
            mixed={mixed}
            unit={unit}
            min={mode === "abs" ? range.min : undefined}
            max={mode === "abs" ? range.max : undefined}
            onChange={(next) => {
              if (mode === "rel") {
                setRelDrafts((current) => ({ ...current, [axis]: next }));
                return;
              }
              setAbsDrafts((current) => ({ ...current, [axis]: next }));
            }}
            onCommit={(next) => handleApply(axis, next)}
          />
        );
      })}
    </div>
  );
};

const segmentMotions = (
  segment: ResolvedMotionSegment,
): Record<VirtualAxisId, ResolvedAxisMotion> => ({
  v1: segmentAxisMotion(segment, "v1"),
  v2: segmentAxisMotion(segment, "v2"),
  v3: segmentAxisMotion(segment, "v3"),
});

const passThroughNotes = (
  segment: ResolvedMotionSegment,
  motions: Record<VirtualAxisId, ResolvedAxisMotion>,
): Partial<Record<VirtualAxisId, string>> => {
  const notes: Partial<Record<VirtualAxisId, string>> = {};
  for (const axis of VIRTUAL_AXIS_IDS) {
    const motion = motions[axis];
    if (!isPassThroughMotion(segment, motion)) continue;
    notes[axis] =
      `${virtualAxisLabel(axis)}在区间端点经过，这里是 ${formatTime(motion.startMs)}–` +
      `${formatDurationSeconds(motion.endMs)} 整段曲线，修改作用于整段`;
  }
  return notes;
};

const EmptyProperties = () => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-9 shrink-0 items-center bg-muted px-3">
      <h2 className="truncate text-label-caps text-foreground">属性</h2>
    </div>
    <EmptySelectionState />
  </div>
);

export const SequencePropertiesPanel = ({
  sequence,
  resolved,
  selection,
  onReplaceBlock,
  onUpdateSegment,
  onDeleteBlock,
}: SequencePropertiesPanelProps) => {
  const { getTimelineObject, sequenceIssues } = useActionBuilder();
  if (selection === null) {
    return <EmptyProperties />;
  }

  const lookup = lookupSequenceSelection(sequence, selection, resolved);

  if (lookup === null) {
    return <EmptyProperties />;
  }

  if (lookup.kind === "segment") {
    const { segment } = lookup;
    const motions = segmentMotions(segment);
    const travel = {
      v1: motions.v1.to - motions.v1.from,
      v2: motions.v2.to - motions.v2.from,
      v3: motions.v3.to - motions.v3.from,
    };
    const profiles: AxisMotionProfiles = {
      v1: motions.v1.profile,
      v2: motions.v2.profile,
      v3: motions.v3.profile,
    };
    const object = getTimelineObject(segment.objectId);
    const disabled = !segment.configurable;
    const axisContext: MotionProfileAxisContext = {
      ...axisContextFromObject(object, travel, segment.durationMs),
      durationMsByAxis: {
        v1: motions.v1.durationMs,
        v2: motions.v2.durationMs,
        v3: motions.v3.durationMs,
      },
    };
    const status = motionProfileSegmentStatus(profiles, axisContext, disabled);
    const configProfiles = (fromRef: string, toRef: string, durationMs: number) =>
      sequence.segments.find((item) => item.fromRef === fromRef && item.toRef === toRef)?.settings
        .profiles ?? createDefaultAxisProfiles(durationMs);
    // 编辑器一次只改一个轴；跨过端点的轴写到它整段曲线的设置上
    const handleProfilesChange = (next: AxisMotionProfiles) => {
      for (const axis of VIRTUAL_AXIS_IDS) {
        if (next[axis] === profiles[axis]) continue;
        const motion = motions[axis];
        const base = configProfiles(motion.fromRef, motion.toRef, motion.durationMs);
        onUpdateSegment(motion.fromRef, motion.toRef, { profiles: { ...base, [axis]: next[axis] } });
      }
    };
    return (
      <PropertiesShell
        title="运动区间"
        plain
        headerStatus={
          <p className={cn("shrink-0 text-body-sm", status.className)}>
            <span aria-hidden>●</span> {status.label}
          </p>
        }
      >
        <RepairBand
          items={formatRepairItems(sequenceIssues ?? [], { segmentKey: segment.key }, {
            objectName: (id) => getTimelineObject(id)?.name,
          })}
        />
        <MotionProfileEditor
          key={`${segment.fromRef}->${segment.toRef}`}
          value={profiles}
          disabled={disabled}
          axisContext={axisContext}
          axisNotes={passThroughNotes(segment, motions)}
          segmentContext={{
            fromRef: segment.fromRef,
            toRef: segment.toRef,
          }}
          onChange={handleProfilesChange}
        />
      </PropertiesShell>
    );
  }

  if (lookup.kind === "multi-block") {
    const poseBlocks = lookup.blocks.filter((block): block is PoseBlock => block.kind === "pose");
    const allPoses = poseBlocks.length === lookup.blocks.length && poseBlocks.length > 0;
    const handleDeleteSelected = () => onDeleteBlock(lookup.blocks.map((block) => block.id));
    if (!allPoses) {
      return (
        <PropertiesShell title="多选" onDelete={handleDeleteSelected}>
          <p className="text-body-sm text-muted-foreground">已选 {lookup.blocks.length} 项</p>
        </PropertiesShell>
      );
    }
    return (
      <PropertiesShell title="多选位姿" onDelete={handleDeleteSelected}>
        <p className="mb-3 text-body-sm text-muted-foreground">已选 {lookup.blocks.length} 项</p>
        <MultiPoseAxesEditor poses={poseBlocks} />
      </PropertiesShell>
    );
  }

  const { block } = lookup;

  if (block.kind === "pose") {
    const poseBlock: PoseBlock = block;
    return (
      <PropertiesShell title="位姿" onDelete={() => onDeleteBlock(poseBlock.id)}>
        <RepairBand
          items={formatRepairItems(sequenceIssues ?? [], { blockId: poseBlock.id }, {
            objectName: (id) => getTimelineObject(id)?.name,
          })}
        />
        <PoseAxesEditor
          key={poseBlock.id}
          pose={poseBlock.pose}
          passThrough={
            resolved.poses.find((point) => point.sourceBlockId === poseBlock.id)?.pose
          }
          uncontrolledAxes={uncontrolledAxesOf(resolved, poseBlock.objectId)}
          objectId={poseBlock.objectId}
          onChange={(pose) => onReplaceBlock({ ...poseBlock, pose })}
        />
        <Field label="时间">
          <UnitAwareNumericInput
            aria-label="到达时间"
            value={msToSeconds(poseBlock.atMs)}
            unit="s"
            step={0.1}
            precision={1}
            min={0}
            onChange={(seconds) => onReplaceBlock({ ...poseBlock, atMs: secondsToMs(seconds) })}
          />
        </Field>
      </PropertiesShell>
    );
  }

  if (block.kind === "instruction" && block.presetId === "set-enabled") {
    const command = block;
    return (
      <PropertiesShell title={instructionBlockTitle(command)} onDelete={() => onDeleteBlock(command.id)}>
        <Field label="使能">
          <input
            type="checkbox"
            aria-label="使能"
            checked={command.instr.enabled}
            onChange={() =>
              onReplaceBlock({
                ...command,
                instr: { enabled: !command.instr.enabled },
              })
            }
            className="h-4 w-4 accent-primary"
          />
        </Field>
        <Field label="时间">
          <UnitAwareNumericInput
            aria-label="时间"
            value={msToSeconds(command.atMs)}
            unit="s"
            step={0.1}
            precision={1}
            min={0}
            onChange={(seconds) => onReplaceBlock({ ...command, atMs: secondsToMs(seconds) })}
          />
        </Field>
      </PropertiesShell>
    );
  }

  if (block.kind === "static-preset" || block.kind === "dynamic-preset") {
    return (
      <PropertiesShell title={presetBlockTitle(block)} onDelete={() => onDeleteBlock(block.id)}>
        <PresetBlockFields
          block={block}
          resolved={resolved}
          onReplaceBlock={onReplaceBlock}
        />
      </PropertiesShell>
    );
  }

  return <EmptyProperties />;
};
