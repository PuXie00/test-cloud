import { Eye, Timer, Trash2, X } from "lucide-react";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { ControlType } from "@/app/project/configuration-types";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { useSelection } from "../../../hooks/use-selection";
import { useActionBuilder } from "../use-action-builder";
import {
  VIRTUAL_AXIS_IDS,
  VIRTUAL_AXIS_META,
} from "../timeline/timeline-data";
import {
  toCanonicalAxisValue,
  toDisplayAxisValue,
} from "../virtual-axis-display";
import { estimateArrivalMs } from "./transition-math";

type AxisCellProps = {
  axis: VirtualAxisId;
  value: number | undefined;
  label: string;
  controlType?: ControlType;
  onChange: (canonicalValue: number) => void;
};

const AxisCell = ({ axis, value, label, controlType, onChange }: AxisCellProps) => {
  const display = useSessionDisplayLengthUnit();
  if (value === undefined) {
    return <span className="text-body-sm text-muted-foreground/50">—</span>;
  }
  return (
    <input
      type="number"
      step="0.1"
      value={toDisplayAxisValue(axis, value, display, controlType)}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const parsed = parseFloat(event.target.value) || 0;
        onChange(toCanonicalAxisValue(axis, parsed, display, controlType));
      }}
      className="w-full rounded-sm bg-transparent px-1 py-0.5 text-right font-mono text-mono-md tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
    />
  );
};

/** 编辑坞形态一：姿态 Cue 编辑器（多轴表格 + 场景捕获 + 预览） */
export const CuePoseEditor = () => {
  const {
    cues,
    programs,
    selectedCueId,
    getTimelineObject,
    handleCueUpdate,
    handleCueTargetChange,
    handleCueRemoveObject,
    handleCueDelete,
    handleCuePreview,
  } = useActionBuilder();
  const { replaceSelection, selectedId } = useSelection();

  const cue = cues.find((item) => item.id === selectedCueId);
  if (!cue) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-body-sm text-muted-foreground">
        Cue 不存在
      </div>
    );
  }

  const objectIds = Object.keys(cue.targets).map((id) => Number(id));
  const arrivalMs = estimateArrivalMs(cue, getTimelineObject);
  const arrivalSec = arrivalMs !== null ? (arrivalMs / 1000).toFixed(1) : null;
  const blockReferenceCount = 0;
  const programReferenceCount = programs.reduce(
    (count, program) =>
      count +
      (program.children ?? []).reduce(
        (chapterCount, chapter) =>
          chapterCount +
          (chapter.children ?? []).filter(
            (item) => item.type === "cue" && item.id === cue.id,
          ).length,
        0,
      ),
    0,
  );

  const handleDeleteCue = async () => {
    const referenceCount = blockReferenceCount + programReferenceCount;
    const detail =
      referenceCount > 0
        ? `同时移除 ${blockReferenceCount} 个动作块和 ${programReferenceCount} 个节目引用。`
        : "";
    const ok = await window.toolAPI.confirm({
      title: "删除 Cue",
      message: `确定删除 Cue“${cue.name}”吗？`,
      detail: detail || undefined,
      danger: true,
    });
    if (!ok) return;
    handleCueDelete(cue.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部：名称 / 预计到达 / 操作 */}
      <div className="flex h-12 shrink-0 items-center gap-3 bg-muted px-3">
        <span className="text-label-caps text-muted-foreground">Cue</span>
        <input
          type="text"
          value={cue.name}
          aria-label="Cue 名称"
          onChange={(event) => handleCueUpdate(cue.id, { name: event.target.value })}
          className="w-40 rounded-sm bg-input-background px-2 py-1.5 text-body-md font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
        />

        {/* Cue 只存目标值：到达时间由当前位置 → 目标值实时估算 */}
        <span
          className="flex items-center gap-1 rounded-md bg-input-background px-2 py-1 text-body-sm text-muted-foreground"
          title="按当前场景位置与各轴速度上限估算"
        >
          <Timer className="h-3.5 w-3.5" aria-hidden />
          当前 → 此Cue
          <span className="font-mono text-mono-md tabular-nums text-foreground">
            {arrivalSec !== null ? `约 ${arrivalSec} s` : "—"}
          </span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* <button
            type="button"
            onClick={() => handleCueCaptureFromScene(cue.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-body-sm text-foreground hover:bg-muted/60"
          >
            从当前场景更新
          </button> */}
          <button
            type="button"
            onClick={() => handleCuePreview(cue.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            预览
          </button>
          <button
            type="button"
            aria-label="删除 Cue"
            onClick={handleDeleteCue}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-destructive hover:bg-destructive/15"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* 姿态表格 */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="grid grid-cols-[minmax(140px,1.4fr)_repeat(3,minmax(90px,1fr))_32px] items-center gap-x-2 px-3 py-1.5 text-label-caps text-muted-foreground">
          <span>物体</span>
          {VIRTUAL_AXIS_IDS.map((axis) => (
            <span key={axis} className="text-right">
              {VIRTUAL_AXIS_META[axis].label}
            </span>
          ))}
          <span className="sr-only">操作</span>
        </div>

        {objectIds.length === 0 && (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            此 Cue 未包含任何物体
          </p>
        )}

        {objectIds.map((objectId) => {
          const object = getTimelineObject(objectId);
          const values = cue.targets[String(objectId)];
          const highlighted = selectedId === objectId;
          return (
            <div
              key={objectId}
              role="button"
              tabIndex={0}
              aria-label={`选中 ${object?.name ?? objectId}`}
              onClick={() => replaceSelection([objectId])}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  replaceSelection([objectId]);
                }
              }}
              className={cn(
                "grid min-h-10 cursor-pointer grid-cols-[minmax(140px,1.4fr)_repeat(3,minmax(90px,1fr))_32px] items-center gap-x-2 border-l-2 px-3 py-1 transition-colors",
                highlighted
                  ? "border-l-primary bg-accent"
                  : "border-l-transparent bg-input-background ",
              )}
            >
              <span className="truncate text-body-sm text-foreground">
                {object?.name ?? objectId}
              </span>
              {VIRTUAL_AXIS_IDS.map((axis: VirtualAxisId) => (
                <div key={axis} className="text-right">
                  <AxisCell
                    axis={axis}
                    value={
                      object?.enabledAxes?.includes(axis) || values?.[axis] !== undefined
                        ? (values?.[axis] ?? 0)
                        : undefined
                    }
                    label={`${object?.name ?? objectId} ${VIRTUAL_AXIS_META[axis].label}`}
                    controlType={object?.controlType}
                    onChange={(value) => handleCueTargetChange(cue.id, objectId, axis, value)}
                  />
                </div>
              ))}
              <button
                type="button"
                aria-label={`从 Cue 移除 ${object?.name ?? objectId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCueRemoveObject(cue.id, objectId);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
