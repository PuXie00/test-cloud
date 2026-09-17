import type { ReactNode } from "react";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import {
  getPresetDefinition,
  presetLabelOf,
  resolvePreset,
  type PresetParamField,
} from "@/app/project/action-sequence/preset-registry";
import { formatBlockRepairItems, localPresetParamIssues } from "@/app/project/action-sequence/preset-repair";
import type { ResolvedActionSequence, ResolvedPosePoint } from "@/app/project/action-sequence/resolve-sequence";
import type {
  DynamicPresetBlock,
  ModelPose,
  PresetParamValue,
  StaticPresetBlock,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import {
  MotionProfileEditor,
  type MotionProfileAxisContext,
} from "../motion-profile/motion-profile-editor";
import { useActionBuilder } from "../use-action-builder";
import {
  VIRTUAL_AXIS_IDS,
  formatTime,
  msToSeconds,
  secondsToMs,
  type ControlledObject,
} from "../timeline/timeline-data";

const usePresetBuilder = () => {
  const builder = useActionBuilder() as {
    getTimelineObject?: (objectId: number) => ControlledObject | undefined;
    sequenceIssues?: import("@/app/project/action-sequence/validate-sequence").SequenceIssue[];
  };
  return {
    getTimelineObject: builder.getTimelineObject ?? (() => undefined),
    sequenceIssues: builder.sequenceIssues ?? [],
  };
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="mb-3">
    <p className="mb-1 text-body-sm text-muted-foreground">{label}</p>
    {children}
  </div>
);

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

const PresetParamControl = ({
  field,
  value,
  onChange,
}: {
  field: PresetParamField;
  value: PresetParamValue | undefined;
  onChange: (value: PresetParamValue) => void;
}) => {
  if (field.kind === "choice" && field.options) {
    const selected = typeof value === "number" ? value : field.options[0]?.value;
    return (
      <div className="flex gap-2" role="group" aria-label={field.label}>
        {field.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-10 flex-1 rounded-md px-2 text-body-sm",
              selected === option.value
                ? "bg-primary font-semibold text-primary-foreground"
                : "border border-border bg-transparent text-foreground hover:bg-accent",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (
    <UnitAwareNumericInput
      aria-label={field.label}
      value={numeric}
      unit={field.unit}
      step={field.step ?? 1}
      precision={1}
      min={field.min}
      max={field.max}
      onChange={(next) => onChange(next)}
    />
  );
};

const ParticipantOrder = ({
  orderedObjectIds,
  onReorder,
}: {
  orderedObjectIds: number[];
  onReorder: (orderedObjectIds: number[]) => void;
}) => {
  const { getTimelineObject } = usePresetBuilder();
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
        {orderedObjectIds.map((objectId, index) => {
          const name = getTimelineObject(objectId)?.name;
          return (
            <li
              key={`${objectId}-${index}`}
              className="flex items-center gap-2 rounded-md bg-input-background px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">
                {name ?? `模型 ${objectId}`}
                <span className="ml-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
                  {objectId}
                </span>
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
          );
        })}
      </ul>
    </Field>
  );
};

const poseOutOfRange = (
  point: ResolvedPosePoint,
  rangeByAxis:
    | Partial<Record<"v1" | "v2" | "v3", { min: number; max: number }>>
    | undefined,
): boolean => {
  if (!rangeByAxis) return false;
  return (["v1", "v2", "v3"] as const).some((axis) => {
    const range = rangeByAxis[axis];
    if (!range) return false;
    const value = point.pose[axis];
    return value < range.min || value > range.max;
  });
};

const GeneratedPoseRows = ({ poses }: { poses: ResolvedPosePoint[] }) => {
  const { getTimelineObject } = usePresetBuilder();
  return (
    <Field label="生成位姿">
      <ul aria-label="生成位姿" className="space-y-1">
        {poses.map((point, index) => {
          const invalid = poseOutOfRange(point, getTimelineObject(point.objectId)?.rangeByAxis);
          return (
            <li
              key={point.sourceRef}
              className={cn(
                "rounded-md px-3 py-2 text-body-sm",
                index % 2 === 0 ? "bg-input-background" : "bg-accent",
                invalid ? "text-warning" : "text-muted-foreground",
              )}
            >
              <span className="mr-3">
                {getTimelineObject(point.objectId)?.name ?? `模型 ${point.objectId}`}
              </span>
              <span className="mr-3 font-mono tabular-nums">
                {point.atMs === null ? "—" : formatTime(point.atMs)}
              </span>
              <span className="font-mono tabular-nums">
                V1 {formatNumber(point.pose.v1)} / V2 {formatNumber(point.pose.v2)} / V3{" "}
                {formatNumber(point.pose.v3)}
              </span>
            </li>
          );
        })}
      </ul>
    </Field>
  );
};

const RepairBand = ({ items }: { items: string[] }) => {
  if (items.length === 0) return null;
  return (
    <section aria-label="待修复内容" className="mb-3 rounded-md bg-warning-surface px-3 py-3">
      <p className="mb-2 text-label-caps text-warning">待修复内容</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-body-sm text-warning">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
};

const poseTravelOf = (poses: readonly ResolvedPosePoint[], objectId: number | undefined): ModelPose => {
  const series = poses
    .filter((point) => point.objectId === objectId)
    .slice()
    .sort((left, right) => left.atMs - right.atMs);
  const travel: ModelPose = { v1: 0, v2: 0, v3: 0 };
  for (let index = 1; index < series.length; index += 1) {
    const from = series[index - 1]?.pose;
    const to = series[index]?.pose;
    if (!from || !to) continue;
    travel.v1 = Math.max(travel.v1, Math.abs(to.v1 - from.v1));
    travel.v2 = Math.max(travel.v2, Math.abs(to.v2 - from.v2));
    travel.v3 = Math.max(travel.v3, Math.abs(to.v3 - from.v3));
  }
  const first = series[0]?.pose;
  const last = series[series.length - 1]?.pose;
  if (first && last) {
    const signed: ModelPose = {
      v1: last.v1 - first.v1,
      v2: last.v2 - first.v2,
      v3: last.v3 - first.v3,
    };
    if (Math.abs(signed.v1) + Math.abs(signed.v2) + Math.abs(signed.v3) > 0) return signed;
  }
  return travel;
};

const generatedPosesFor = (
  resolved: ResolvedActionSequence,
  block: StaticPresetBlock | DynamicPresetBlock,
): ResolvedPosePoint[] => {
  const fromResolved = resolved.poses.filter((point) => point.sourceBlockId === block.id);
  if (fromResolved.length > 0) return fromResolved;
  try {
    return resolvePreset(block).map((point) => ({
      ...point,
      sourceKind: block.kind,
      sourceBlockId: block.id,
      editable: false,
    }));
  } catch {
    return [];
  }
};

export const presetBlockTitle = (block: StaticPresetBlock | DynamicPresetBlock): string => {
  const kindLabel = block.kind === "static-preset" ? "静态预设" : "动态预设";
  const name = presetLabelOf(block.presetId);
  return name === block.presetId ? kindLabel : `${kindLabel} · ${name}`;
};

type PresetBlockFieldsProps = {
  block: StaticPresetBlock | DynamicPresetBlock;
  resolved: ResolvedActionSequence;
  onReplaceBlock: (block: TimelineBlock) => void;
};

export const PresetBlockFields = ({
  block,
  resolved,
  onReplaceBlock,
}: PresetBlockFieldsProps) => {
  const { getTimelineObject, sequenceIssues } = usePresetBuilder();
  const definition = getPresetDefinition(block.presetId);
  const poses = generatedPosesFor(resolved, block);
  const counts = block.orderedObjectIds.map(
    (objectId) => poses.filter((point) => point.objectId === objectId).length,
  );
  const uniqueCounts = new Set(counts);
  const perObject = uniqueCounts.size === 1 ? counts[0] : undefined;
  const repairItems = formatBlockRepairItems(
    [
      ...localPresetParamIssues(block.presetId, block.params).map((issue) => ({
        ...issue,
        blockId: block.id,
      })),
      ...(sequenceIssues ?? []),
    ],
    block.id,
    {
      presetId: block.presetId,
      objectName: (id) => getTimelineObject(id)?.name,
    },
  );

  const handleParam = (key: string, value: PresetParamValue) => {
    onReplaceBlock({ ...block, params: { ...block.params, [key]: value } });
  };

  return (
    <>
      <RepairBand items={repairItems} />
      {definition ? (
        <>
          <p className="mb-3 text-body-sm text-muted-foreground">{definition.description}</p>
          <p className="mb-3 font-mono text-mono-sm tabular-nums text-muted-foreground">
            {perObject !== undefined
              ? `每物体 ${perObject} 个位姿 · ${block.orderedObjectIds.length} 个物体`
              : `生成 ${poses.length} 个位姿 · ${block.orderedObjectIds.length} 个物体`}
          </p>
          {definition.paramFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <PresetParamControl
                field={field}
                value={block.params[field.key]}
                onChange={(value) => handleParam(field.key, value)}
              />
            </Field>
          ))}
        </>
      ) : (
        <p className="mb-3 text-body-sm text-warning">未知预设 {block.presetId}</p>
      )}
      <ParticipantOrder
        orderedObjectIds={block.orderedObjectIds}
        onReorder={(orderedObjectIds) => onReplaceBlock({ ...block, orderedObjectIds })}
      />
      {block.kind === "dynamic-preset" ? (
        <>
          <Field label="曲线">
            <MotionProfileEditor
              value={block.profiles}
              onChange={(profiles) => onReplaceBlock({ ...block, profiles })}
              axisContext={axisContextFromObject(
                block.orderedObjectIds[0] === undefined
                  ? undefined
                  : getTimelineObject(block.orderedObjectIds[0]),
                poseTravelOf(poses, block.orderedObjectIds[0]),
                Math.max(block.endMs - block.startMs, 0),
              )}
            />
          </Field>
          <Field label="开始">
            <UnitAwareNumericInput
              aria-label="开始时间"
              value={msToSeconds(block.startMs)}
              unit="s"
              step={0.1}
              precision={1}
              min={0}
              onChange={(seconds) => onReplaceBlock({ ...block, startMs: secondsToMs(seconds) })}
            />
          </Field>
          <Field label="结束">
            <UnitAwareNumericInput
              aria-label="结束时间"
              value={msToSeconds(block.endMs)}
              unit="s"
              step={0.1}
              precision={1}
              min={0}
              onChange={(seconds) => onReplaceBlock({ ...block, endMs: secondsToMs(seconds) })}
            />
          </Field>
        </>
      ) : null}
      <GeneratedPoseRows poses={poses} />
    </>
  );
};
