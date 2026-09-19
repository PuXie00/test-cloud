import type { ReactNode } from "react";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import {
  dynamicPresetProfileDurationMs,
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
import { RepairBand } from "./repair-band";
import {
  VIRTUAL_AXIS_IDS,
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

const Field = ({
  label,
  children,
  stacked = false,
}: {
  label: string;
  children: ReactNode;
  stacked?: boolean;
}) => {
  if (stacked) {
    return (
      <div className="mb-3">
        <p className="mb-1 text-body-sm text-muted-foreground">{label}</p>
        {children}
      </div>
    );
  }
  return (
    <div className="mb-2 flex min-h-10 items-center justify-between gap-3">
      <p className="w-24 shrink-0 text-body-sm text-muted-foreground">{label}</p>
      <div className="min-w-0 flex-1">{children}</div>
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
      visible: true,
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
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-body-sm text-muted-foreground">{definition.description}</p>
            <p className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {perObject !== undefined
                ? `每物体 ${perObject} 个位姿`
                : `${poses.length} 个位姿`}
            </p>
          </div>
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
      {block.kind === "dynamic-preset" ? (
        <>
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
          <Field label="曲线" stacked>
            <MotionProfileEditor
              value={block.profiles}
              onChange={(profiles) => onReplaceBlock({ ...block, profiles })}
              ownedAxes={definition?.ownedAxes}
              axisContext={axisContextFromObject(
                block.orderedObjectIds[0] === undefined
                  ? undefined
                  : getTimelineObject(block.orderedObjectIds[0]),
                poseTravelOf(poses, block.orderedObjectIds[0]),
                dynamicPresetProfileDurationMs(block),
              )}
            />
          </Field>
        </>
      ) : null}
    </>
  );
};
