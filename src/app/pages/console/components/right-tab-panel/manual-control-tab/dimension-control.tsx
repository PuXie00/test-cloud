import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/app/components/ui/checkbox";
import { TabBar } from "@/app/components/ics/tab-bar";
import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { useSelection } from "../../../hooks/use-selection";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import {
  goEntriesForObjectIds,
  pendingGoEntries,
  resolveGoTargets,
} from "../../../hooks/go-ready";
import { useGoReady } from "../../../hooks/go-ready-provider";
import { DIMENSION_KEY_TO_VIRTUAL_AXIS } from "@/app/project/manual-jog";
import type { VirtualAxisValues } from "@/app/project/project-document-types";

type DimensionMode = "abs" | "rel";

type DimensionControlProps = {
  dimensions: DimensionDescriptor[];
};

const MODE_TABS = [
  { id: "abs", label: "绝对" },
  { id: "rel", label: "相对" },
] as const;

const draftsFromTargets = (
  dimensions: DimensionDescriptor[],
  targets: VirtualAxisValues,
  mode: DimensionMode,
): Record<string, number> =>
  Object.fromEntries(
    dimensions.map((dim) => {
      if (mode === "rel") return [dim.key, 0];
      const axis = DIMENSION_KEY_TO_VIRTUAL_AXIS[dim.key];
      const target = axis ? targets[axis] : undefined;
      return [dim.key, target ?? 0];
    }),
  );

export const DimensionControl = ({ dimensions }: DimensionControlProps) => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();
  const { state, arm, go, cancel } = useGoReady();

  const [mode, setMode] = useState<DimensionMode>("abs");
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const selectedIds =
    multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
  const snapshots = selectedIds.flatMap((id) => {
    const snapshot = getById(id);
    return snapshot ? [snapshot] : [];
  });
  const primaryObjectId = snapshots[0] ? String(snapshots[0].descriptor.id) : null;

  // 绝对模式仅回填已设 GO 目标值，无目标则为 0
  const targets = useMemo(() => {
    if (!primaryObjectId) return {};
    return state.entries.find((entry) => entry.objectId === primaryObjectId)?.target ?? {};
  }, [primaryObjectId, state.entries]);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const dimensionsRef = useRef(dimensions);
  dimensionsRef.current = dimensions;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const dimensionKey = useMemo(
    () => dimensions.map((dim) => dim.key).join(","),
    [dimensions],
  );
  const targetSig = useMemo(
    () =>
      Object.entries(targets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([axis, value]) => `${axis}:${value}`)
        .join("|"),
    [targets],
  );

  // 切物体 / 切模式 / 维度集合 / 选中目标被取消时回填。
  // 不依赖 dimensions、entries 引用：遥测每帧都会换新对象，拖动时会把草稿打回旧目标。
  useEffect(() => {
    setDrafts(draftsFromTargets(dimensionsRef.current, targetsRef.current, mode));
  }, [mode, dimensionKey, primaryObjectId, targetSig]);

  const handleCommit = (dim: DimensionDescriptor, canonical: number) => {
    const next = { ...draftsRef.current, [dim.key]: canonical };
    setDrafts(next);
    const armedTargetsByObjectId = Object.fromEntries(
      state.entries.map((entry) => [entry.objectId, entry.target]),
    );
    const entries = resolveGoTargets(snapshots, next, mode, armedTargetsByObjectId);
    if (entries.length === 0) {
      toast.error("所选物体无虚轴位置数据，无法进入 GO 准备");
      return;
    }
    arm(entries, mode);
  };

  const handleModeChange = (next: DimensionMode) => {
    setMode(next);
  };

  const selectedObjectIds = selectedIds.map(String);
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
            <div className="flex justify-center">
              <TabBar
                tabs={MODE_TABS}
                active={mode}
                onChange={handleModeChange}
                className="h-7 w-44 border-b-0 bg-transparent"
              />
            </div>
            {dimensions.map((dim, index) => (
              <Fragment key={dim.key}>
                <div className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-body-sm text-foreground">虚轴{index + 1}</span>
                  <UnitAwareNumericInput
                    unit={dim.mixed ? "--" : dim.unit}
                    min={-1000}
                    max={100000}
                    step={index === 0 ? 1 : 0.1}
                    precision={1}
                    value={drafts[dim.key] ?? 0}
                    onChange={(canonical) =>
                      setDrafts((current) => ({ ...current, [dim.key]: canonical }))
                    }
                    onCommit={(canonical) => handleCommit(dim, canonical)}
                    aria-label={`虚轴${index + 1}`}
                    className="w-full border-border border"
                  />
                </div>
                {dim.mixed && (
                  <p className="text-body-sm text-warning">单位不一致，按 mm 处理</p>
                )}
              </Fragment>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="取消选中物体 GO"
                disabled={!canCancelSelected}
                onClick={handleCancel}
                className="h-10 flex-1 rounded-sm border border-primary font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
              >
                清除
              </button>
              <button
                type="button"
                aria-label="选中物体 GO"
                disabled={!canGoSelected}
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
