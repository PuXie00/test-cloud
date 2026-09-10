import { useEffect, useState, type ReactNode } from "react";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import { getPresetDefinition } from "@/app/project/action-sequence/preset-registry";
import type { ResolvedActionSequence, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  DynamicPresetBlock,
  ModelPose,
  MotionSegmentSettings,
  PoseBlock,
  PresetParamValue,
  SetEnabledBlock,
  StaticPresetBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import {
  MotionProfileEditor,
  type MotionProfileAxisContext,
} from "../motion-profile/motion-profile-editor";
import { motionProfileSegmentStatus } from "../motion-profile/motion-profile-status";
import { EmptySelectionState } from "./empty-selection-state";
import { lookupSequenceSelection, type SequenceSelection } from "../sequence-selection";
import { VIRTUAL_AXIS_IDS, type ControlledObject } from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";

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

const PRESET_LABELS: Record<string, string> = {
  "static-flat": "平面",
  "static-slope": "斜面",
  "static-arc": "弧形",
  "static-wave": "静态波浪",
  "dynamic-level": "水平升降",
  "dynamic-wave": "行进波浪",
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const paramUnit = (key: string): string | undefined => {
  if (key === "sampleIntervalMs") return "ms";
  if (/V1$|^v1$|^amplitude$/i.test(key)) return "mm";
  if (/V2$|^v2$|V3$|^v3$|Deg$/i.test(key)) return "°";
  if (key.endsWith("Ms")) return "ms";
  return undefined;
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

  const handleDraftChange = (axis: (typeof VIRTUAL_AXIS_IDS)[number], value: number) => {
    setDrafts((current) => ({ ...current, [axis]: value }));
  };

  const handleCommit = (axis: (typeof VIRTUAL_AXIS_IDS)[number], value: number) => {
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
      {VIRTUAL_AXIS_IDS.map((axis, index) => {
        const range = object?.rangeByAxis?.[axis];
        const axisLabel = `虚轴${index + 1}`;
        return (
          <div key={axis} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-body-sm text-foreground">{axisLabel}</span>
            <UnitAwareNumericInput
              aria-label={axisLabel}
              value={drafts[axis]}
              unit={getVirtualAxisCanonicalUnit(axis, object?.controlType)}
              step={poseAxisStep(axis)}
              precision={1}
              min={mode === "abs" ? range?.min : undefined}
              max={mode === "abs" ? range?.max : undefined}
              onChange={(value) => handleDraftChange(axis, value)}
              onCommit={(value) => handleCommit(axis, value)}
              className="w-full border-border border"
            />
          </div>
        );
      })}
    </div>
  );
};

const PresetParamFields = ({
  params,
  onChange,
}: {
  params: Record<string, PresetParamValue>;
  onChange: (key: string, value: PresetParamValue) => void;
}) => (
  <>
    {Object.entries(params).map(([key, value]) => {
      if (typeof value === "boolean") {
        return (
          <Field key={key} label={key}>
            <input
              type="checkbox"
              aria-label={key}
              checked={value}
              onChange={() => onChange(key, !value)}
              className="h-4 w-4 accent-primary"
            />
          </Field>
        );
      }
      if (typeof value === "string") {
        return (
          <Field key={key} label={key}>
            <input
              type="text"
              aria-label={key}
              value={value}
              onChange={(event) => onChange(key, event.target.value)}
              className="w-full rounded-md border border-border/60 bg-input-background px-2 py-1 font-mono text-mono-sm tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
        );
      }
      return (
        <Field key={key} label={key}>
          <UnitAwareNumericInput
            aria-label={key}
            value={value}
            unit={paramUnit(key)}
            step={1}
            precision={1}
            onChange={(next) => onChange(key, next)}
          />
        </Field>
      );
    })}
  </>
);

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
            {point.atMs === null ? "—" : `${point.atMs} ms`}
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
    return (
      <PropertiesShell title="多选">
        <p className="text-body-sm text-muted-foreground">已选 {lookup.blocks.length} 项</p>
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
            value={poseBlock.atMs}
            unit="ms"
            step={1}
            precision={0}
            min={0}
            onChange={(atMs) => onReplaceBlock({ ...poseBlock, atMs })}
          />
        </Field>
      </PropertiesShell>
    );
  }

  if (block.kind === "set-enabled") {
    const command: SetEnabledBlock = block;
    return (
      <PropertiesShell title="使能指令" onDelete={() => onDeleteBlock(command.id)}>
        <Field label="使能">
          <input
            type="checkbox"
            aria-label="使能"
            checked={command.enabled}
            onChange={() => onReplaceBlock({ ...command, enabled: !command.enabled })}
            className="h-4 w-4 accent-primary"
          />
        </Field>
        <Field label="时间">
          <UnitAwareNumericInput
            aria-label="时间"
            value={command.atMs}
            unit="ms"
            step={1}
            precision={0}
            min={0}
            onChange={(atMs) => onReplaceBlock({ ...command, atMs })}
          />
        </Field>
      </PropertiesShell>
    );
  }

  if (block.kind === "static-preset") {
    const preset: StaticPresetBlock = block;
    const definition = getPresetDefinition(preset.presetId);
    const title = `静态预设${PRESET_LABELS[preset.presetId] ? ` · ${PRESET_LABELS[preset.presetId]}` : ""}`;
    return (
      <PropertiesShell title={title} onDelete={() => onDeleteBlock(preset.id)}>
        {definition ? (
          <PresetParamFields
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
  const title = `动态预设${PRESET_LABELS[preset.presetId] ? ` · ${PRESET_LABELS[preset.presetId]}` : ""}`;
  return (
    <PropertiesShell title={title} onDelete={() => onDeleteBlock(preset.id)}>
      {definition ? (
        <PresetParamFields
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
      <Field label="曲线">
        <MotionProfileEditor
          value={preset.profiles}
          onChange={(profiles) => onReplaceBlock({ ...preset, profiles })}
          axisContext={axisContextFromObject(
            preset.orderedObjectIds[0] === undefined
              ? undefined
              : getTimelineObject(preset.orderedObjectIds[0]),
            { v1: 0, v2: 0, v3: 0 },
            Math.max(preset.endMs - preset.startMs, 0),
          )}
        />
      </Field>
      <Field label="开始">
        <UnitAwareNumericInput
          aria-label="开始时间"
          value={preset.startMs}
          unit="ms"
          step={1}
          precision={0}
          min={0}
          onChange={(startMs) => onReplaceBlock({ ...preset, startMs })}
        />
      </Field>
      <Field label="结束">
        <UnitAwareNumericInput
          aria-label="结束时间"
          value={preset.endMs}
          unit="ms"
          step={1}
          precision={0}
          min={0}
          onChange={(endMs) => onReplaceBlock({ ...preset, endMs })}
        />
      </Field>
      <GeneratedPoseRows poses={generatedPosesFor(resolved, preset.id)} />
    </PropertiesShell>
  );
};
