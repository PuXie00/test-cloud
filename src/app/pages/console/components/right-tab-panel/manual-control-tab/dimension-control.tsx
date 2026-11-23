import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/components/ui/utils";
import { TabBar } from "@/app/components/ics/tab-bar";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import { useSelection } from "../../../hooks/use-selection";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { goEntriesForObjectIds, pendingGoEntries } from "../../../hooks/go-ready";
import { useGoReady } from "../../../hooks/go-ready-provider";
import { useProjectStore } from "../../../hooks/use-project-store";
import { AXIS_MODE_TABS, virtualAxisLabel, type AxisEditMode } from "../../action-builder/virtual-axis-edit";
import { formatQuantity } from "../../action-builder/motion-profile/quantity-format";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { VirtualAxisRow } from "../../action-builder/virtual-axis-row";
import {
  axisInputRange,
  axisUnit,
  buildDimensionEntries,
  buildDimensionParticipants,
  sharedAxisValue,
  unionAxes,
  type DimensionWrite,
} from "./dimension-edit";

type DimensionControlProps = {
  disabled?: boolean;
  /** 操作这些物体；不传时跟随全局选择 */
  objectIds?: readonly number[];
  /** 「清除」时另外要做的事（动作页：取消选中的位姿）；给了时没有 GO 目标也能点 */
  onClear?: () => void;
  /**
   * 写到别处而不是设 GO 目标（动作页选着位姿：直接改位姿，影子跟着位姿动）；
   * 相对时加在位姿的值上
   */
  onWrite?: (write: DimensionWrite) => void;
  /** 每根轴下面显示物体当前的实际位置（和输入框里的目标对照） */
  showCurrent?: boolean;
  /** 单轴取当前：只把这一根轴的实时位置写回（动作页选着位姿时） */
  onCaptureAxis?: (axis: VirtualAxisId) => void;
};

/** 输入框里还没写入 GO 目标的值：绝对是输入的位置，相对是相对当前实际位置的增量 */
type AxisDrafts = Partial<Record<VirtualAxisId, number>>;

const targetSignature = (target: VirtualAxisValues | undefined): string =>
  target ? `${target.v1 ?? ""},${target.v2 ?? ""},${target.v3 ?? ""}` : "-";

/**
 * 维度控制：虚轴的批量编辑规则和动作页「多选位姿」一致（见 dimension-edit.ts），
 * 区别是写入先设为 GO 目标并显示影子模型，按 GO 才执行。
 */
export const DimensionControl = ({
  disabled = false,
  objectIds,
  onClear,
  onWrite,
  showCurrent = false,
  onCaptureAxis,
}: DimensionControlProps) => {
  const display = useSessionDisplayLengthUnit();
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { state, arm, go, cancel } = useGoReady();

  const [mode, setMode] = useState<AxisEditMode>("abs");
  const [drafts, setDrafts] = useState<AxisDrafts>({});

  const selectedIds =
    objectIds ??
    (multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : []);
  const snapshots = selectedIds.flatMap((id) => {
    const snapshot = getById(id);
    return snapshot ? [snapshot] : [];
  });
  const participants = buildDimensionParticipants(snapshots, objects);
  const axes = unionAxes(participants);
  const armedTargetsByObjectId = Object.fromEntries(
    state.entries.map((entry) => [entry.objectId, entry.target]),
  );

  // 切模式 / 换选择 / 所选物体的 GO 目标变了（写入、取消、到位）时清掉输入框里的草稿。
  // 遥测每帧都会刷新，所以不能依赖 snapshots 的引用。
  const resetKey = [
    mode,
    ...participants.map(
      (item) => `${item.objectId}:${targetSignature(armedTargetsByObjectId[item.objectId])}`,
    ),
  ].join("|");
  useEffect(() => {
    setDrafts({});
  }, [resetKey]);

  const handleDraftChange = (axis: VirtualAxisId, value: number) => {
    setDrafts((current) => ({ ...current, [axis]: value }));
  };

  const handleCommit = (axis: VirtualAxisId, value: number) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[axis];
      return next;
    });
    if (onWrite) {
      if (mode === "rel" && value === 0) return;
      onWrite({ mode, axis, value });
      return;
    }
    const { entries, missingPosition } = buildDimensionEntries(
      participants,
      { mode, axis, value },
      armedTargetsByObjectId,
    );
    if (entries.length === 0) {
      if (missingPosition) toast.error("所选物体无虚轴位置数据，无法进入 GO 准备");
      return;
    }
    arm(entries, mode);
  };

  const selectedObjectIds = participants.map((item) => item.objectId);
  const selectedEntries = goEntriesForObjectIds(state.entries, selectedObjectIds);
  const canGoSelected = pendingGoEntries(selectedEntries).length > 0;
  const canCancelSelected = selectedEntries.length > 0 || onClear !== undefined;

  const handleGo = () => {
    if (selectedObjectIds.length === 0) return;
    void go(selectedObjectIds);
  };

  const handleCancel = () => {
    if (selectedObjectIds.length > 0) cancel(selectedObjectIds);
    onClear?.();
  };

  return (
    <div data-guide="console-controlled-object-move" className="space-y-2 px-3 py-3">
      <div className="rounded-md overflow-hidden">
        <div className="flex h-9 items-center justify-between bg-muted px-3">
          <span>维度控制</span>
          <span className="pointer-events-none opacity-40">
            <Checkbox checked disabled>
              默认速度
            </Checkbox>
          </span>
        </div>
        <div className="bg-background p-3">
          <div className="space-y-2">
            <div className={cn("flex justify-center", disabled && "pointer-events-none opacity-40")}>
              <TabBar
                tabs={AXIS_MODE_TABS}
                active={mode}
                onChange={setMode}
                className="h-7 w-44 border-b-0 bg-transparent"
              />
            </div>
            {axes.map((axis) => {
              const range = axisInputRange(participants, axis);
              const shared = sharedAxisValue(participants, axis, armedTargetsByObjectId);
              const draft = drafts[axis];
              const value = mode === "rel" ? (draft ?? 0) : (draft ?? shared ?? 0);
              const mixed = mode === "abs" && draft === undefined && shared === undefined;
              const unit = axisUnit(participants, axis);
              // 当前实际位置：各物体一致时显示，不一致或没有数据时 --
              const current = showCurrent ? sharedAxisValue(participants, axis, {}) : undefined;
              const label = virtualAxisLabel(axis);
              return (
                <div key={axis} className="space-y-1">
                  <VirtualAxisRow
                    axis={axis}
                    value={value}
                    mixed={mixed}
                    unit={unit}
                    min={mode === "abs" ? range.min : undefined}
                    max={mode === "abs" ? range.max : undefined}
                    disabled={disabled}
                    onChange={(next) => handleDraftChange(axis, next)}
                    onCommit={(next) => handleCommit(axis, next)}
                  />
                  {showCurrent ? (
                    <div className="flex min-h-7 items-center justify-between gap-2 pl-14 text-body-sm text-muted-foreground">
                      <span aria-label={`${label} 当前位置`} className="font-mono tabular-nums">
                        当前 {current === undefined ? "--" : unit ? formatQuantity(current, unit, display) : current.toFixed(1)}
                      </span>
                      {onCaptureAxis ? (
                        <button
                          type="button"
                          aria-label={`${label} 取当前`}
                          title="只把这一根轴的实时位置写进位姿"
                          disabled={current === undefined && participants.every((item) => item.snapshot.positions == null)}
                          onClick={() => onCaptureAxis(axis)}
                          className="h-7 shrink-0 rounded-sm border border-border px-2 text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                        >
                          取当前
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="取消选中物体 GO"
                // 设备离线等不能操作时，动作页仍可以用它清掉选中的位姿
                disabled={(disabled && onClear === undefined) || !canCancelSelected}
                onClick={handleCancel}
                className="h-10 flex-1 rounded-sm border border-primary font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
              >
                清除
              </button>
              <button
                data-guide="console-controlled-object-move-confirm"
                type="button"
                aria-label="选中物体 GO"
                disabled={disabled || !canGoSelected}
                onClick={handleGo}
                className="h-10 flex-1 rounded-sm bg-primary font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                GO
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
