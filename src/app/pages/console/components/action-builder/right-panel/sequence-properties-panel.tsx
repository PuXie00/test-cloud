import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import { getPresetDefinition, type PresetParamField } from "@/app/project/action-sequence/preset-registry";
import { instructionBlockTitle } from "@/app/project/action-sequence/instruction-registry";
import type { ResolvedActionSequence, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  ModelPose,
  MotionSegmentSettings,
  PoseBlock,
  PresetParamValue,
  StaticPresetBlock,
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
import { lookupSequenceSelection, type SequenceSelection } from "../sequence-selection";
import type { PoseAxisWrite } from "../sequence-ops";
import {
  VIRTUAL_AXIS_IDS,
  formatTime,
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
  onDeleteBlock: (blockId: string) => void;
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const presetBlockTitle = (kind: "static" | "dynamic", presetId: string): string => {
  const prefix = kind === "static" ? "静态预设" : "动态预设";
  const label = getPresetDefinition(presetId)?.label;
  return label ? `${prefix} · ${label}` : prefix;
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

const dynamicPresetTravel = (preset: DynamicPresetBlock): ModelPose => {
  if (preset.presetId === "dynamic-level") {
    const startHeightMm = typeof preset.params.startHeightMm === "number" ? preset.params.startHeightMm : 0;
    const endHeightMm = typeof preset.params.endHeightMm === "number" ? preset.params.endHeightMm : 0;
    return { v1: endHeightMm - startHeightMm, v2: 0, v3: 0 };
  }
  if (preset.presetId === "dynamic-wave") {
    const amplitudeMm = typeof preset.params.amplitudeMm === "number" ? preset.params.amplitudeMm : 0;
    return { v1: 2 * Math.abs(amplitudeMm), v2: 0, v3: 0 };
  }
  return { v1: 0, v2: 0, v3: 0 };
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

const PresetParamFields = ({
  fields,
  params,
  onChange,
}: {
  fields: readonly PresetParamField[];
  params: Record<string, PresetParamValue>;
  onChange: (key: string, value: PresetParamValue) => void;
}) => (
  <>
    {fields.map((field) => {
      if (field.kind === "boolean") {
        const checked = params[field.key] === true;
        const handleToggle = () => onChange(field.key, !checked);
        const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          handleToggle();
        };
        return (
          <Field key={field.key} label={field.label}>
            <input
              type="checkbox"
              aria-label={field.label}
              checked={checked}
              onChange={handleToggle}
              onKeyDown={handleKeyDown}
              className="h-4 w-4 accent-primary"
            />
          </Field>
        );
      }
      if (field.kind === "enum") {
        const current = params[field.key];
        const selected =
          typeof current === "number" && field.options.some((option) => option.value === current)
            ? current
            : field.options[0]?.value;
        return (
          <Field key={field.key} label={field.label}>
            <select
              aria-label={field.label}
              value={selected === undefined ? "" : String(selected)}
              onChange={(event) => onChange(field.key, Number(event.target.value))}
              className="h-9 w-full rounded-md border border-border/60 bg-input-background px-2 text-body-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        );
      }
      const numeric = typeof params[field.key] === "number" ? params[field.key] : 0;
      return (
        <Field key={field.key} label={field.label}>
          <UnitAwareNumericInput
            aria-label={field.label}
            value={numeric}
            unit={field.unit}
            step={field.step ?? 1}
            precision={field.precision ?? 1}
            min={field.min}
            max={field.max}
            onChange={(next) => onChange(field.key, next)}
          />
        </Field>
      );
    })}
  </>
);

const LevelAverageSpeed = ({
  startHeightMm,
  endHeightMm,
  durationMs,
}: {
  startHeightMm: number;
  endHeightMm: number;
  durationMs: number;
}) => {
  const speed = durationMs > 0 ? Math.abs(endHeightMm - startHeightMm) / (durationMs / 1000) : 0;
  return (
    <Field label="平均速度">
      <p className="font-mono text-mono-sm tabular-nums text-foreground" aria-label="平均速度">
        {formatNumber(speed)} mm/s
      </p>
    </Field>
  );
};

const ParticipantOrder = ({
  orderedObjectIds,
  onReorder,
}: {
  orderedObjectIds: number[];
  onReorder: (orderedObjectIds: number[]) => void;
}) => {
  const handleMove = (from: number, to: number) => {
    if (to < 0 || to >= orderedObjectIds.length) return;
    const next = [...orderedObjectIds];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onReorder(next);
  };

  return (
    <Field label="参与物体顺序">
      <ul className="space-y-1">
        {orderedObjectIds.map((objectId, index) => (
          <li
            key={`${objectId}-${index}`}
            className="flex items-center gap-2 rounded-md bg-input-background px-2 py-1"
          >
            <span className="min-w-0 flex-1 font-mono text-mono-sm tabular-nums text-foreground">
              {objectId}
            </span>
            <button
              type="button"
              aria-label={`上移 ${objectId}`}
              disabled={index === 0}
              onClick={() => handleMove(index, index - 1)}
              className="h-8 rounded-md border border-border bg-transparent px-2 text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
            >
              上移
            </button>
            <button
              type="button"
              aria-label={`下移 ${objectId}`}
              disabled={index === orderedObjectIds.length - 1}
              onClick={() => handleMove(index, index + 1)}
              className="h-8 rounded-md border border-border bg-transparent px-2 text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
            >
              下移
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
};

const GeneratedPoseRows = ({ poses }: { poses: ResolvedPosePoint[] }) => (
  <Field label="生成位姿">
    <ul aria-label="生成位姿" className="space-y-1">
      {poses.map((point) => (
        <li
          key={point.sourceRef}
          className="rounded-md bg-input-background px-3 py-2 text-body-sm text-muted-foreground"
        >
          <span className="mr-3">模型 {point.objectId}</span>
          <span className="mr-3 font-mono tabular-nums">
            {point.atMs === null ? "—" : formatTime(point.atMs)}
          </span>
          <span className="font-mono tabular-nums">
            V1 {formatNumber(point.pose.v1)} / V2 {formatNumber(point.pose.v2)} / V3{" "}
            {formatNumber(point.pose.v3)}
          </span>
        </li>
      ))}
    </ul>
  </Field>
);

const generatedPosesFor = (
  resolved: ResolvedActionSequence,
  blockId: string,
): ResolvedPosePoint[] => resolved.poses.filter((point) => point.sourceBlockId === blockId);

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
  const { getTimelineObject } = useActionBuilder();
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
    if (!allPoses) {
      return (
        <PropertiesShell title="多选">
          <p className="text-body-sm text-muted-foreground">已选 {lookup.blocks.length} 项</p>
        </PropertiesShell>
      );
    }
    return (
      <PropertiesShell title="多选位姿">
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

  if (block.kind === "static-preset") {
    const preset: StaticPresetBlock = block;
    const definition = getPresetDefinition(preset.presetId);
    const title = presetBlockTitle("static", preset.presetId);
    return (
      <PropertiesShell title={title} onDelete={() => onDeleteBlock(preset.id)}>
        {definition ? (
          <PresetParamFields
            fields={definition.paramFields}
            params={preset.params}
            onChange={(key, value) =>
              onReplaceBlock({ ...preset, params: { ...preset.params, [key]: value } })
            }
          />
        ) : (
          <p className="mb-3 text-body-sm text-warning">未知预设 {preset.presetId}</p>
        )}
        <ParticipantOrder
          orderedObjectIds={preset.orderedObjectIds}
          onReorder={(orderedObjectIds) => onReplaceBlock({ ...preset, orderedObjectIds })}
        />
        <GeneratedPoseRows poses={generatedPosesFor(resolved, preset.id)} />
      </PropertiesShell>
    );
  }

  const preset: DynamicPresetBlock = block;
  const definition = getPresetDefinition(preset.presetId);
  const title = presetBlockTitle("dynamic", preset.presetId);
  const startHeightMm =
    typeof preset.params.startHeightMm === "number" ? preset.params.startHeightMm : 0;
  const endHeightMm = typeof preset.params.endHeightMm === "number" ? preset.params.endHeightMm : 0;
  return (
    <PropertiesShell title={title} onDelete={() => onDeleteBlock(preset.id)}>
      {definition ? (
        <PresetParamFields
          fields={definition.paramFields}
          params={preset.params}
          onChange={(key, value) =>
            onReplaceBlock({ ...preset, params: { ...preset.params, [key]: value } })
          }
        />
      ) : (
        <p className="mb-3 text-body-sm text-warning">未知预设 {preset.presetId}</p>
      )}
      {preset.presetId === "dynamic-level" ? (
        <LevelAverageSpeed
          startHeightMm={startHeightMm}
          endHeightMm={endHeightMm}
          durationMs={Math.max(preset.endMs - preset.startMs, 0)}
        />
      ) : null}
      <ParticipantOrder
        orderedObjectIds={preset.orderedObjectIds}
        onReorder={(orderedObjectIds) => onReplaceBlock({ ...preset, orderedObjectIds })}
      />
      <Field label="曲线">
        <MotionProfileEditor
          value={preset.profiles}
          onChange={(profiles) => onReplaceBlock({ ...preset, profiles })}
          axisContext={axisContextFromObject(
            preset.orderedObjectIds[0] === undefined
              ? undefined
              : getTimelineObject(preset.orderedObjectIds[0]),
            dynamicPresetTravel(preset),
            Math.max(preset.endMs - preset.startMs, 0),
          )}
        />
      </Field>
      <Field label="开始">
        <UnitAwareNumericInput
          aria-label="开始时间"
          value={msToSeconds(preset.startMs)}
          unit="s"
          step={0.1}
          precision={1}
          min={0}
          onChange={(seconds) => onReplaceBlock({ ...preset, startMs: secondsToMs(seconds) })}
        />
      </Field>
      <Field label="结束">
        <UnitAwareNumericInput
          aria-label="结束时间"
          value={msToSeconds(preset.endMs)}
          unit="s"
          step={0.1}
          precision={1}
          min={0}
          onChange={(seconds) => onReplaceBlock({ ...preset, endMs: secondsToMs(seconds) })}
        />
      </Field>
      <GeneratedPoseRows poses={generatedPosesFor(resolved, preset.id)} />
    </PropertiesShell>
  );
};
