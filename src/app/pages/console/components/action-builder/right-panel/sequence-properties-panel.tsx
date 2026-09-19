import { useEffect, useRef, useState, type ReactNode } from "react";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import { instructionBlockTitle } from "@/app/project/action-sequence/instruction-registry";
import { formatRepairItems } from "@/app/project/action-sequence/preset-repair";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  ModelPose,
  MotionSegmentSettings,
  PoseBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
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
  msToSeconds,
  secondsToMs,
  type ControlledObject,
} from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
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

const poseAxisStep = (axis: (typeof VIRTUAL_AXIS_IDS)[number]): number =>
  axis === "v1" ? 1 : 0.1;

type PoseAxisMode = "abs" | "rel";

const POSE_MODE_TABS = [
  { id: "abs", label: "绝对" },
  { id: "rel", label: "相对" },
] as const;

const ZERO_POSE: ModelPose = { v1: 0, v2: 0, v3: 0 };

const poseAxisLabel = (axis: VirtualAxisId): string =>
  `虚轴${VIRTUAL_AXIS_IDS.indexOf(axis) + 1}`;

const poseSelectionKey = (poses: readonly PoseBlock[]): string =>
  poses.map((block) => `${block.id}:${block.pose.v1},${block.pose.v2},${block.pose.v3}`).join("|");

const intersectAxisRange = (
  ranges: readonly { min: number; max: number }[],
): { min?: number; max?: number } => {
  if (ranges.length === 0) return {};
  const min = Math.max(...ranges.map((range) => range.min));
  const max = Math.min(...ranges.map((range) => range.max));
  if (min > max) return {};
  return { min, max };
};

const PoseAxisRow = ({
  axis,
  value,
  mixed = false,
  unit,
  min,
  max,
  onChange,
  onCommit,
}: {
  axis: VirtualAxisId;
  value: number;
  mixed?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) => {
  const axisLabel = poseAxisLabel(axis);
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-body-sm text-foreground">{axisLabel}</span>
      <UnitAwareNumericInput
        aria-label={axisLabel}
        value={value}
        mixed={mixed}
        unit={unit}
        step={poseAxisStep(axis)}
        precision={1}
        min={min}
        max={max}
        onChange={onChange}
        onCommit={onCommit}
        className="w-full border-border border"
      />
    </div>
  );
};

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
  objectId,
  onChange,
}: {
  pose: ModelPose;
  objectId: number;
  onChange: (pose: ModelPose) => void;
}) => {
  const { getTimelineObject } = useActionBuilder();
  const object = getTimelineObject(objectId);
  const [mode, setMode] = useState<PoseAxisMode>("abs");
  const [drafts, setDrafts] = useState<ModelPose>(pose);

  useEffect(() => {
    setDrafts(mode === "rel" ? ZERO_POSE : { v1: pose.v1, v2: pose.v2, v3: pose.v3 });
  }, [mode, pose.v1, pose.v2, pose.v3]);

  const handleModeChange = (next: PoseAxisMode) => {
    setMode(next);
  };

  const enabledAxes = resolveEnabledAxes(object?.enabledAxes ?? []);

  const handleDraftChange = (axis: VirtualAxisId, value: number) => {
    setDrafts((current) => ({ ...current, [axis]: value }));
  };

  const handleCommit = (axis: VirtualAxisId, value: number) => {
    const range = object?.rangeByAxis?.[axis];
    const nextValue = mode === "rel" ? pose[axis] + value : value;
    const clamped = clampNumeric(nextValue, range?.min, range?.max);
    setDrafts((current) => ({
      ...current,
      [axis]: mode === "rel" ? 0 : clamped,
    }));
    if (clamped === pose[axis]) return;
    onChange({ ...pose, [axis]: clamped });
  };

  return (
    <div className="mb-3 space-y-2">
      <div className="flex justify-center">
        <TabBar
          tabs={POSE_MODE_TABS}
          active={mode}
          onChange={handleModeChange}
          className="h-7 w-44 border-b-0 bg-transparent"
        />
      </div>
      {enabledAxes.map((axis) => {
        const range = object?.rangeByAxis?.[axis];
        return (
          <PoseAxisRow
            key={axis}
            axis={axis}
            value={drafts[axis]}
            unit={getVirtualAxisCanonicalUnit(axis, object?.controlType)}
            min={mode === "abs" ? range?.min : undefined}
            max={mode === "abs" ? range?.max : undefined}
            onChange={(value) => handleDraftChange(axis, value)}
            onCommit={(value) => handleCommit(axis, value)}
          />
        );
      })}
    </div>
  );
};

const MultiPoseAxesEditor = ({ poses }: { poses: PoseBlock[] }) => {
  const { getTimelineObject, handleApplyPoseAxisWrite } = useActionBuilder();
  const [mode, setMode] = useState<PoseAxisMode>("abs");
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

  const handleModeChange = (next: PoseAxisMode) => {
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
          tabs={POSE_MODE_TABS}
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
          <PoseAxisRow
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
    const travel = {
      v1: segment.toPose.v1 - segment.fromPose.v1,
      v2: segment.toPose.v2 - segment.fromPose.v2,
      v3: segment.toPose.v3 - segment.fromPose.v3,
    };
    const object = getTimelineObject(segment.objectId);
    const disabled = !segment.configurable;
    const axisContext = axisContextFromObject(object, travel, segment.durationMs);
    const status = motionProfileSegmentStatus(
      segment.settings.profiles,
      axisContext,
      disabled,
    );
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
          value={segment.settings.profiles}
          disabled={disabled}
          axisContext={axisContext}
          segmentContext={{
            fromRef: segment.fromRef,
            toRef: segment.toRef,
          }}
          onChange={(profiles) =>
            onUpdateSegment(segment.fromRef, segment.toRef, { profiles })
          }
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
