import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { clampNumeric } from "@/app/components/ics/numeric-input-utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { cn } from "@/app/components/ui/utils";
import { instructionBlockTitle } from "@/app/project/action-sequence/instruction-registry";
import { isAxisSet, withoutAxis } from "@/app/project/action-sequence/keyframe-pose";
import { formatRepairItems } from "@/app/project/action-sequence/preset-repair";
import {
  uncontrolledAxesOf,
  type PoseJunction,
  type PoseJunctionKind,
  type ResolvedActionSequence,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  KeyframePose,
  ModelPose,
  MotionSegmentSettings,
  PoseBlock,
  TimelineBlock,
  TimelineMarker,
} from "@/app/project/action-sequence/types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { resolveEnabledAxes } from "../motion-profile/motion-profile-status";
import { EmptySelectionState } from "./empty-selection-state";
import { MultiSegmentEditor } from "./multi-segment-editor";
import { PresetBlockFields, presetBlockTitle } from "./preset-block-panel";
import { RepairBand } from "./repair-band";
import { SegmentEditor, SegmentStatusBadge, segmentStatusOf } from "./segment-editor";
import {
  lookupSequenceSelection,
  type SelectionFocus,
  type SequenceSelection,
} from "../sequence-selection";
import type { PoseAxisWrite } from "../sequence-ops";
import {
  VIRTUAL_AXIS_IDS,
  formatTime,
  msToSeconds,
  secondsToMs,
} from "../timeline/timeline-data";
import { clampMarkerName } from "../marker-ops";
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

/**
 * 返回：清空时间轴上选中的动作块（或标记），物体选中保留，
 * 选着物体时就回到「新建位姿、指令、预设」。
 */
const BackToAddButton = () => {
  const { handleSelectionChange } = useActionBuilder();
  if (!handleSelectionChange) return null;
  return (
    <button
      type="button"
      aria-label="返回"
      title="取消选中的动作块，回到添加位姿、指令"
      onClick={() => handleSelectionChange(null)}
      className="-ml-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
    </button>
  );
};

const PropertiesShell = ({
  title,
  children,
  onDelete,
  plain = false,
  headerStatus,
  actions,
}: {
  title: string;
  children: ReactNode;
  onDelete?: () => void;
  plain?: boolean;
  headerStatus?: ReactNode;
  /** 删除按钮上方的其它操作，如拆解预设 */
  actions?: ReactNode;
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 bg-muted px-3">
      <div className="flex min-w-0 items-center gap-1">
        <BackToAddButton />
        <h2 className="truncate text-label-caps text-foreground">{title}</h2>
      </div>
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
        {actions || onDelete ? (
          <div className="mt-4 flex flex-col gap-2">
            {actions}
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-9 w-full items-center justify-center rounded-md bg-destructive text-body-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  </div>
);

/** 拆解预设：换成各物体的关键点位姿 */
const ExplodePresetsButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border text-body-sm font-semibold text-foreground hover:bg-accent"
  >
    {label}
  </button>
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

const AxisToggle = ({
  label,
  pressed,
  disabled,
  title,
  children,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    title={title}
    onClick={onClick}
    className={cn(
      "h-8 shrink-0 rounded-md px-2 text-body-sm disabled:cursor-not-allowed disabled:opacity-50",
      pressed
        ? "bg-primary font-semibold text-primary-foreground"
        : "border border-border text-foreground hover:bg-accent",
    )}
  >
    {children}
  </button>
);

type PassSpeeds = Partial<Record<VirtualAxisId, number>>;

type PoseAxesChange = { pose: KeyframePose; passSpeeds: PassSpeeds };

const JUNCTION_LABEL: Record<PoseJunctionKind, string> = {
  auto: "自动",
  manual: "手填",
  edge: "起止停",
  reverse: "折返停",
  hold: "停留",
  seam: "随首帧",
};

const PoseAxesEditor = ({
  pose,
  passSpeeds,
  passThrough,
  junctions,
  uncontrolledAxes,
  objectId,
  onChange,
}: {
  pose: KeyframePose;
  passSpeeds: PassSpeeds;
  /** 解析后的位姿：不设定的轴取这一帧的经过值 */
  passThrough: ModelPose | undefined;
  /** 各设定轴在这一帧的经过速度及原因 */
  junctions: Partial<Record<VirtualAxisId, PoseJunction>>;
  /** 该物体在所有位姿上都不设定的轴：序列不控制，没有经过值 */
  uncontrolledAxes: readonly VirtualAxisId[];
  objectId: number;
  onChange: (change: PoseAxesChange) => void;
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
  const emit = (nextPose: KeyframePose, nextSpeeds: PassSpeeds = passSpeeds) => {
    const kept: PassSpeeds = {};
    for (const axis of VIRTUAL_AXIS_IDS) {
      const speed = nextSpeeds[axis];
      if (speed !== undefined && isAxisSet(nextPose, axis)) kept[axis] = speed;
    }
    onChange({ pose: nextPose, passSpeeds: kept });
  };

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
    emit({ ...pose, [axis]: clamped });
  };

  const handleTogglePassThrough = (axis: VirtualAxisId) => {
    if (isAxisSet(pose, axis)) {
      if (setCount <= 1) return;
      emit(withoutAxis(pose, axis));
      return;
    }
    // 重新设定时取这一帧的经过值，轨迹位置不跳；序列原本不控制的轴取实时位置
    const value = uncontrolledAxes.includes(axis)
      ? (getLivePose?.(objectId)?.[axis] ?? shown[axis])
      : shown[axis];
    emit({ ...pose, [axis]: roundProjectCoordinate(value) });
  };

  const handlePassSpeedCommit = (axis: VirtualAxisId, value: number) => {
    emit(pose, { ...passSpeeds, [axis]: roundProjectCoordinate(Math.max(0, value)) });
  };

  const handlePassSpeedAuto = (axis: VirtualAxisId) => {
    const next = { ...passSpeeds };
    delete next[axis];
    emit(pose, next);
  };

  const passingAxes = enabledAxes.filter(
    (axis) => !isAxisSet(pose, axis) && !uncontrolledAxes.includes(axis),
  );
  const freeAxes = enabledAxes.filter((axis) => uncontrolledAxes.includes(axis));
  const speedAxes = enabledAxes.filter((axis) => isAxisSet(pose, axis) && junctions[axis]);

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
        const label = virtualAxisLabel(axis);
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
            <AxisToggle
              label={`${label} 经过`}
              pressed={passing}
              disabled={onlySet}
              title={onlySet ? "至少设定一个轴" : "不设定：这一帧不停，按前后设定值之间的曲线经过"}
              onClick={() => handleTogglePassThrough(axis)}
            >
              经过
            </AxisToggle>
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
      {speedAxes.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-body-sm text-muted-foreground">经过速度（0 即停在这一帧）</p>
          {speedAxes.map((axis) => {
            const junction = junctions[axis]!;
            const label = virtualAxisLabel(axis);
            const editable = junction.kind === "auto" || junction.kind === "manual";
            const status =
              junction.kind === "manual" && junction.speed === 0 ? "停" : JUNCTION_LABEL[junction.kind];
            return (
              <div
                key={axis}
                role="group"
                aria-label={`${label} 经过速度设置`}
                className="flex items-center gap-2"
              >
                <span className="w-12 shrink-0 text-body-sm text-foreground">{label}</span>
                <div className="min-w-0 flex-1">
                  <UnitAwareNumericInput
                    aria-label={`${label} 经过速度`}
                    value={roundProjectCoordinate(junction.speed)}
                    unit={`${getVirtualAxisCanonicalUnit(axis, object?.controlType)}/s`}
                    min={0}
                    step={1}
                    precision={1}
                    disabled={!editable}
                    onCommit={(value) => handlePassSpeedCommit(axis, value)}
                    className="w-full border-border border"
                  />
                </div>
                <span className="w-12 shrink-0 text-body-sm text-muted-foreground">{status}</span>
                {junction.kind === "manual" ? (
                  <button
                    type="button"
                    aria-label={`${label} 经过速度改回自动`}
                    onClick={() => handlePassSpeedAuto(axis)}
                    className="h-8 shrink-0 rounded-md border border-border px-2 text-body-sm text-foreground hover:bg-accent"
                  >
                    自动
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
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

type MultiTab = "segments" | "poses";

const OTHER_KIND_LABEL: Record<Exclude<TimelineBlock["kind"], "pose">, string> = {
  instruction: "指令",
  "static-preset": "静态预设",
  "dynamic-preset": "动态预设",
};

/** 多选里不能批量改的块：只报数量 */
const otherKindsSummary = (blocks: readonly TimelineBlock[]): string | null => {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === "pose") continue;
    const label = OTHER_KIND_LABEL[block.kind];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = [...counts].map(([label, count]) => `${label} ${count} 个`);
  return `另有 ${parts.join("、")}，多选时不能修改`;
};

/**
 * 多选：按种类分页签。两端都选中的运动区间是一类（点区间进来先显示它），位姿是一类；
 * 其它块只报数量。
 */
const MultiSelectionProperties = ({
  sequence,
  blocks,
  segments,
  focus,
  onUpdateSegment,
  onDeleteBlock,
}: {
  sequence: ActionSequenceConfig;
  blocks: TimelineBlock[];
  segments: ResolvedMotionSegment[];
  focus?: SelectionFocus;
  onUpdateSegment: SequencePropertiesPanelProps["onUpdateSegment"];
  onDeleteBlock: (blockId: string | string[]) => void;
}) => {
  const { getTimelineObject, handleExplodePresets } = useActionBuilder();
  const poseBlocks = blocks.filter((block): block is PoseBlock => block.kind === "pose");
  const presetIds = blocks
    .filter((block) => block.kind === "static-preset" || block.kind === "dynamic-preset")
    .map((block) => block.id);
  const explodeAction =
    presetIds.length > 0 ? (
      <ExplodePresetsButton
        label={`拆解所选预设（${presetIds.length}）`}
        onClick={() => handleExplodePresets(presetIds)}
      />
    ) : undefined;
  const tabs: Array<{ id: MultiTab; label: string }> = [
    ...(segments.length > 0
      ? [{ id: "segments" as const, label: `运动区间（${segments.length}）` }]
      : []),
    ...(poseBlocks.length > 0 ? [{ id: "poses" as const, label: `位姿（${poseBlocks.length}）` }] : []),
  ];
  const defaultTab: MultiTab | undefined =
    focus === "segments" && segments.length > 0
      ? "segments"
      : poseBlocks.length > 0
        ? "poses"
        : tabs[0]?.id;
  // 手动切的页签只对这一次选中有效；换了选中回到默认（点区间进来是运动区间，框选是位姿）
  const selectionKey = `${focus ?? ""}:${blocks.map((block) => block.id).join("|")}`;
  const [picked, setPicked] = useState<{ key: string; tab: MultiTab } | null>(null);
  const pickedTab = picked?.key === selectionKey ? picked.tab : undefined;
  const tab = tabs.some((item) => item.id === pickedTab) ? pickedTab : defaultTab;
  const setPickedTab = (next: MultiTab) => setPicked({ key: selectionKey, tab: next });
  const handleDeleteSelected = () => onDeleteBlock(blocks.map((block) => block.id));
  const others = otherKindsSummary(blocks);

  if (tab === undefined) {
    return (
      <PropertiesShell title="多选" onDelete={handleDeleteSelected} actions={explodeAction}>
        <p className="text-body-sm text-muted-foreground">已选 {blocks.length} 项</p>
      </PropertiesShell>
    );
  }

  const tabBar =
    tabs.length > 1 ? (
      <TabBar
        tabs={tabs}
        active={tab}
        onChange={setPickedTab}
        variant="filled"
        className="mb-2 h-8 rounded-md"
      />
    ) : null;
  const othersNote = others ? (
    <p className="mt-2 px-1 text-body-sm text-muted-foreground">{others}</p>
  ) : null;

  if (tab === "segments") {
    const single = segments.length === 1 ? segments[0] : undefined;
    const needsCheck = segments.filter(
      (segment) => segmentStatusOf(segment, getTimelineObject(segment.objectId)).label === "需检查",
    ).length;
    const status = single
      ? segmentStatusOf(single, getTimelineObject(single.objectId))
      : needsCheck > 0
        ? { label: `${needsCheck} 段需检查`, className: "text-warning" }
        : { label: "配置有效", className: "text-show" };
    return (
      <PropertiesShell
        title={single ? "运动区间" : "多选运动区间"}
        plain
        headerStatus={<SegmentStatusBadge status={status} />}
        actions={explodeAction}
      >
        {tabBar}
        {single ? (
          <SegmentEditor sequence={sequence} segment={single} onUpdateSegment={onUpdateSegment} />
        ) : (
          <MultiSegmentEditor segments={segments} />
        )}
        {othersNote}
      </PropertiesShell>
    );
  }

  return (
    <PropertiesShell
      title="多选位姿"
      plain
      onDelete={handleDeleteSelected}
      actions={explodeAction}
    >
      {tabBar}
      <div className="rounded-md bg-muted p-4">
        <p className="mb-3 text-body-sm text-muted-foreground">已选 {blocks.length} 项</p>
        <MultiPoseAxesEditor poses={poseBlocks} />
      </div>
      {othersNote}
    </PropertiesShell>
  );
};

/** 时间轴标记：一个时改名、改时刻；多个时只能一起删 */
const MarkerProperties = ({ markers }: { markers: TimelineMarker[] }) => {
  const { handleRenameMarker, handleSetMarkerTime, handleDeleteMarkers } = useActionBuilder();
  const marker = markers.length === 1 ? markers[0] : undefined;
  const [draft, setDraft] = useState(marker?.name ?? "");

  useEffect(() => {
    if (marker) setDraft(marker.name);
  }, [marker?.id, marker?.name]);

  if (!marker) {
    return (
      <PropertiesShell
        title="多选标记"
        onDelete={() => handleDeleteMarkers(markers.map((item) => item.id))}
      >
        <p className="text-body-sm text-muted-foreground">已选 {markers.length} 个标记</p>
        <ul className="mt-2 space-y-1">
          {markers.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 text-body-sm text-foreground">
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatTime(item.atMs)} s
              </span>
            </li>
          ))}
        </ul>
      </PropertiesShell>
    );
  }

  const commitName = () => {
    if (draft.trim().length === 0) {
      setDraft(marker.name);
      return;
    }
    handleRenameMarker(marker.id, draft);
  };

  return (
    <PropertiesShell title="标记" onDelete={() => handleDeleteMarkers([marker.id])}>
      <Field label="名称">
        <input
          aria-label="标记名称"
          value={draft}
          onChange={(event) => setDraft(clampMarkerName(event.target.value))}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitName();
            if (event.key === "Escape") setDraft(marker.name);
          }}
          className="h-8 w-full rounded-md border border-border/60 bg-input-background px-2 text-body-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>
      <Field label="时间">
        <UnitAwareNumericInput
          aria-label="标记时间"
          value={msToSeconds(marker.atMs)}
          unit="s"
          step={0.1}
          precision={1}
          min={0}
          onCommit={(seconds) => handleSetMarkerTime(marker.id, secondsToMs(seconds))}
        />
      </Field>
      <p className="text-body-sm text-muted-foreground">标记只是标注，不下发设备</p>
    </PropertiesShell>
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
  const { getTimelineObject, sequenceIssues, handleExplodePresets } = useActionBuilder();
  if (selection === null) {
    return <EmptyProperties />;
  }

  const lookup = lookupSequenceSelection(sequence, selection, resolved);

  if (lookup === null) {
    return <EmptyProperties />;
  }

  if (lookup.kind === "markers") {
    return <MarkerProperties markers={lookup.markers} />;
  }

  if (lookup.kind === "multi-block") {
    return (
      <MultiSelectionProperties
        sequence={sequence}
        blocks={lookup.blocks}
        segments={lookup.segments}
        focus={lookup.focus}
        onUpdateSegment={onUpdateSegment}
        onDeleteBlock={onDeleteBlock}
      />
    );
  }

  const { block } = lookup;

  if (block.kind === "pose") {
    const poseBlock: PoseBlock = block;
    const resolvedPoint = resolved.poses.find((point) => point.sourceBlockId === poseBlock.id);
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
          passSpeeds={poseBlock.passSpeeds ?? {}}
          passThrough={resolvedPoint?.pose}
          junctions={resolvedPoint?.junctions ?? {}}
          uncontrolledAxes={uncontrolledAxesOf(resolved, poseBlock.objectId)}
          objectId={poseBlock.objectId}
          onChange={({ pose, passSpeeds }) => {
            const { passSpeeds: _previous, ...rest } = poseBlock;
            onReplaceBlock(
              Object.keys(passSpeeds).length > 0 ? { ...rest, pose, passSpeeds } : { ...rest, pose },
            );
          }}
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
      <PropertiesShell
        title={presetBlockTitle(block)}
        onDelete={() => onDeleteBlock(block.id)}
        actions={
          <ExplodePresetsButton
            label="拆解为位姿"
            onClick={() => handleExplodePresets([block.id])}
          />
        }
      >
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
