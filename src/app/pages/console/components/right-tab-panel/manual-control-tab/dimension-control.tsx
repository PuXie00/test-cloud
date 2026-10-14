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
import { AXIS_MODE_TABS, type AxisEditMode } from "../../action-builder/virtual-axis-edit";
import { VirtualAxisRow } from "../../action-builder/virtual-axis-row";
import {
  axisInputRange,
  axisUnit,
  buildDimensionEntries,
  buildDimensionParticipants,
  sharedAxisValue,
  unionAxes,
} from "./dimension-edit";

type DimensionControlProps = {
  disabled?: boolean;
};

/** 输入框里还没写入 GO 目标的值：绝对是输入的位置，相对是增量 */
type AxisDrafts = Partial<Record<VirtualAxisId, number>>;

const targetSignature = (target: VirtualAxisValues | undefined): string =>
  target ? `${target.v1 ?? ""},${target.v2 ?? ""},${target.v3 ?? ""}` : "-";

/**
 * 维度控制：虚轴的批量编辑规则和动作页「多选位姿」一致（见 dimension-edit.ts），
 * 区别是写入先设为 GO 目标并显示影子模型，按 GO 才执行。
 */
export const DimensionControl = ({ disabled = false }: DimensionControlProps) => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const { state, arm, go, cancel } = useGoReady();

  const [mode, setMode] = useState<AxisEditMode>("abs");
  const [drafts, setDrafts] = useState<AxisDrafts>({});

  const selectedIds =
    multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
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
  const canCancelSelected = selectedEntries.length > 0;

  const handleGo = () => {
    if (selectedObjectIds.length === 0) return;
    void go(selectedObjectIds);
  };

  const handleCancel = () => {
    if (selectedObjectIds.length === 0) return;
    cancel(selectedObjectIds);
  };

  return (
    <div className="space-y-2 px-3 py-3">
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
              return (
                <VirtualAxisRow
                  key={axis}
                  axis={axis}
                  value={value}
                  mixed={mixed}
                  unit={axisUnit(participants, axis)}
                  min={mode === "abs" ? range.min : undefined}
                  max={mode === "abs" ? range.max : undefined}
                  disabled={disabled}
                  onChange={(next) => handleDraftChange(axis, next)}
                  onCommit={(next) => handleCommit(axis, next)}
                />
              );
            })}
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="取消选中物体 GO"
                disabled={disabled || !canCancelSelected}
                onClick={handleCancel}
                className="h-10 flex-1 rounded-sm border border-primary font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
              >
                清除
              </button>
              <button
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
