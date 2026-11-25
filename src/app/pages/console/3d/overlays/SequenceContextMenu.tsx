import { useEffect, useState } from "react";
import { usePermissions } from "@/app/auth/permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
  resolveActionSequence,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig, ModelPose } from "@/app/project/action-sequence/types";
import type { ViewportCellId } from "@/app/viz3d";
import type { MotionPathSample } from "@/app/viz3d/pose-handles/motion-path-types";
import { motionPathSampleStepMs, sampleMotionPaths } from "../../components/action-builder/motion-path-entries";
import { poseBlocksAtCursor } from "../../components/action-builder/pose-handle-targets";
import { useLiveCapture } from "../../components/action-builder/right-panel/live-edit";
import { selectionFromBlockIds } from "../../components/action-builder/sequence-selection";
import { useActionBuilder } from "../../components/action-builder/use-action-builder";
import { poseFromControlSnapshot } from "../../components/right-tab-panel/manual-control-tab/pose-from-control-snapshot";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { useProjectStore } from "../../hooks/use-project-store";
import {
  adjacentPoseTimes,
  FLAT_SPREAD_M,
  focusMotionLabel,
  formatFactor,
  FORMATION_EDGES,
  HEIGHT_SPREAD_PRESETS,
  poseBlockIdsAt,
  sequenceMenuTitle,
} from "../sequence-context-menu-model";
import { useActionPreviewPoses } from "../use-action-preview-poses";
import { useViz3DContext } from "../Viz3DProvider";
import { toProjectObjectIds } from "../viz3d-selection-sync";
import { HeightSpreadDialog, type HeightSpreadPrompt } from "./height-spread-dialog";

const menuContentClass =
  "z-[9999] min-w-[13rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";
const subMenuContentClass =
  "z-[9999] min-w-[10rem] border border-border bg-card p-1 text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.4)]";
const menuItemClass = "text-body-sm";
const labelClass = "px-2 py-1 text-caption font-normal text-muted-foreground";

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const resolveOrNull = (sequence: ActionSequenceConfig): ResolvedActionSequence | null => {
  try {
    return resolveActionSequence(sequence);
  } catch {
    return null;
  }
};

type SequenceContextMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 菜单出现的位置（视口坐标） */
  point: { x: number; y: number };
  /** 右键的物体（引擎 id）；空白处为 null */
  contextObjectId: string | null;
  /** 右键所在的那一格：「看全」在这一格里框 */
  cellId: ViewportCellId | null;
};

/** 动作页 3D 右键菜单：游标处加位姿 / 选位姿、跳到前后位姿、取当前、看全动作、队形工具 */
export const SequenceContextMenu = ({ open, onOpenChange, point, contextObjectId, cellId }: SequenceContextMenuProps) => {
  // 菜单关了对话框还在：放在菜单外面
  const [spreadPrompt, setSpreadPrompt] = useState<HeightSpreadPrompt | null>(null);
  return (
    <>
      <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: point.x, top: point.y }}
          />
        </DropdownMenuTrigger>
        {open ? (
          <SequenceContextMenuContent
            contextObjectId={contextObjectId}
            cellId={cellId}
            onSpreadPrompt={setSpreadPrompt}
          />
        ) : null}
      </DropdownMenu>
      <HeightSpreadDialog prompt={spreadPrompt} onClose={() => setSpreadPrompt(null)} />
    </>
  );
};

const SequenceContextMenuContent = ({
  contextObjectId,
  cellId,
  onSpreadPrompt,
}: {
  contextObjectId: string | null;
  cellId: ViewportCellId | null;
  onSpreadPrompt: (prompt: HeightSpreadPrompt) => void;
}) => {
  const engine = useViz3DContext();
  const {
    sequence,
    cursorMs,
    getTimelineObject,
    handleCreatePose,
    handleViewportObjectsPick,
    handleCursorChange,
    handleSelectionChange,
  } = useActionBuilder();
  const canEdit = usePermissions().can("action.edit");
  const { getById } = useControlledObjects();
  const { objects } = useProjectStore();
  const capture = useLiveCapture();
  const shown = useActionPreviewPoses();

  // 右键时可能刚换了选中；手柄目标随后才换：两样都跟着刷新
  const [engineSelection, setEngineSelection] = useState(() => engine.getSelection());
  const [formation, setFormation] = useState(() => engine.getPoseFormationInfo(contextObjectId));
  useEffect(() => {
    const handleSelection = () => setEngineSelection(engine.getSelection());
    const handleHandles = () => setFormation(engine.getPoseFormationInfo(contextObjectId));
    engine.events.on("selectionChange", handleSelection);
    engine.events.on("poseHandlesChange", handleHandles);
    handleSelection();
    handleHandles();
    return () => {
      engine.events.off("selectionChange", handleSelection);
      engine.events.off("poseHandlesChange", handleHandles);
    };
  }, [engine, contextObjectId]);

  const engineIdOf = (objectId: number) => engine.resolveObjectId(String(objectId)) ?? String(objectId);
  // 时间轴上有的物体（受控物体）才有位姿
  const objectIds = toProjectObjectIds(engineSelection, (id) => engine.resolveSnapshotId(id)).filter(
    (objectId) => getTimelineObject(objectId) !== undefined,
  );
  const contextId = contextObjectId ? Number(engine.resolveSnapshotId(contextObjectId) ?? contextObjectId) : null;
  const contextName =
    contextId === null
      ? null
      : (getTimelineObject(contextId)?.name ?? objects.find((object) => object.id === contextId)?.name ?? null);
  const title = sequenceMenuTitle({ contextName, selectedCount: objectIds.length });

  if (!sequence) {
    return (
      <DropdownMenuContent className={menuContentClass} align="start" side="right" sideOffset={2}>
        <DropdownMenuItem disabled className={menuItemClass}>
          先在左侧打开一条动作序列
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  }

  const atCursor = poseBlocksAtCursor(sequence, objectIds, cursorMs);
  const allHavePose = objectIds.length > 0 && objectIds.every((id) => atCursor.some((block) => block.objectId === id));
  const { prev, next } = adjacentPoseTimes(sequence, objectIds, cursorMs);
  const liveIds = objectIds.filter((id) => getById(id)?.positions);

  const jumpTo = (atMs: number) => {
    handleCursorChange(atMs, { reveal: true });
    const blockIds = poseBlockIdsAt(sequence, objectIds, atMs);
    if (blockIds.length > 0) handleSelectionChange(selectionFromBlockIds(blockIds));
  };

  const captureCurrent = () =>
    capture.save({
      objectIds: liveIds,
      poseForObject: (objectId) => {
        const snapshot = getById(objectId);
        return snapshot ? poseFromControlSnapshot(snapshot) : null;
      },
    });

  // 看全：选中的物体（没选就是序列里全部）整段动作扫过的范围；挂载的按父物体那一刻的样子叠加
  const focusMotion = () => {
    const resolved = resolveOrNull(sequence);
    const sequenceIds = resolved ? [...resolved.posesByObject.keys()] : [];
    const targets = objectIds.length > 0 ? objectIds : sequenceIds;
    if (targets.length === 0) return;
    const samples = new Map<string, MotionPathSample[]>();
    if (resolved) {
      const sampled = sampleMotionPaths(resolved, sequenceIds, motionPathSampleStepMs(resolved.totalMs));
      for (const [objectId, list] of sampled) {
        // 序列不控制的轴按 3D 正在显示的值
        const live = shown.get(objectId);
        const pinned: Partial<ModelPose> = {};
        for (const axis of uncontrolledAxesOf(resolved, objectId)) {
          const value = live?.[axis];
          if (value !== undefined) pinned[axis] = value;
        }
        samples.set(
          engineIdOf(objectId),
          list.map((sample) => ({ atMs: sample.atMs, values: { ...sample.pose, ...pinned } })),
        );
      }
    }
    engine.focusMotionRange(targets.map(engineIdOf), samples, cellId ?? undefined);
  };

  const showFormation = objectIds.length >= 2;
  const memberCount = formation?.memberIds.length ?? 0;
  const spread = formation?.spread ?? null;
  const flat = spread !== null && spread.max - spread.min < FLAT_SPREAD_M;
  const formationHint =
    memberCount > 0
      ? null
      : !canEdit
        ? "没有编辑权限"
        : (formation?.blocked[0]?.reason ?? "选中的物体都不能升降");

  return (
    <DropdownMenuContent
      className={menuContentClass}
      align="start"
      side="right"
      sideOffset={2}
      data-testid="sequence-viewport-menu"
    >
      <DropdownMenuLabel className={labelClass}>{title}</DropdownMenuLabel>
      <DropdownMenuItem
        disabled={!canEdit || objectIds.length === 0 || allHavePose}
        className={menuItemClass}
        onSelect={() => handleCreatePose(objectIds)}
      >
        在游标处加位姿
        <DropdownMenuShortcut>K</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={atCursor.length === 0}
        className={menuItemClass}
        onSelect={() => handleViewportObjectsPick(objectIds, false)}
      >
        选中游标处的位姿
      </DropdownMenuItem>
      <DropdownMenuItem disabled={prev === null} className={menuItemClass} onSelect={() => prev !== null && jumpTo(prev)}>
        跳到上一个位姿
        {prev !== null ? <DropdownMenuShortcut>{formatSeconds(prev)}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={next === null} className={menuItemClass} onSelect={() => next !== null && jumpTo(next)}>
        跳到下一个位姿
        {next !== null ? <DropdownMenuShortcut>{formatSeconds(next)}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
      {liveIds.length > 0 ? (
        <DropdownMenuItem
          disabled={!canEdit || capture.saveBlockedReason !== null}
          title={capture.saveBlockedReason ?? undefined}
          className={menuItemClass}
          onSelect={captureCurrent}
        >
          {capture.saveLabel}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator className="bg-border" />
      <DropdownMenuItem className={menuItemClass} onSelect={focusMotion}>
        {focusMotionLabel(objectIds.length)}
      </DropdownMenuItem>
      {showFormation ? (
        <>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuLabel className={labelClass}>队形</DropdownMenuLabel>
          {formationHint ? (
            <DropdownMenuItem disabled className={menuItemClass}>
              {formationHint}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!formation?.canAlign} className={menuItemClass}>
                  {contextObjectId ? "高度对齐到这台" : "高度对齐到这台（在物体上右键）"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={subMenuContentClass}>
                  {FORMATION_EDGES.map(({ edge, label }) => (
                    <DropdownMenuItem
                      key={edge}
                      className={menuItemClass}
                      onSelect={() =>
                        contextObjectId && engine.applyPoseFormation({ kind: "align", referenceId: contextObjectId, edge })
                      }
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={spread === null || flat} className={menuItemClass}>
                  {flat ? "高低差（一样高）" : spread === null ? "高低差（至少两台能升降）" : "高低差"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className={subMenuContentClass}>
                  {HEIGHT_SPREAD_PRESETS.map(({ factor, label }) => (
                    <DropdownMenuItem
                      key={factor}
                      className={menuItemClass}
                      onSelect={() => engine.applyPoseFormation({ kind: "scale", factor })}
                    >
                      {label}
                      <DropdownMenuShortcut>{formatFactor(factor)}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    className={menuItemClass}
                    onSelect={() =>
                      spread &&
                      onSpreadPrompt({
                        spreadM: spread.max - spread.min,
                        count: memberCount,
                        onConfirm: (factor) => engine.applyPoseFormation({ kind: "scale", factor }),
                      })
                    }
                  >
                    按比例…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </>
      ) : null}
    </DropdownMenuContent>
  );
};
