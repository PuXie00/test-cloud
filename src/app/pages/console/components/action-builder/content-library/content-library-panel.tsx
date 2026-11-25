import { usePermissions } from "@/app/auth/permissions";
import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ArrowLeftRight, ListClock, Plus, Search, X } from "lucide-react";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { cn } from "@/app/components/ui/utils";
import { useActionBuilder } from "../use-action-builder";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { sequenceShape } from "@/app/project/action-sequence/sequence-shape";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { getSequenceContentRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import type { ProjectDocument } from "@/app/project/project-document-types";
import {
  countSequenceBlocks,
  formatDurationSeconds,
  formatTime,
  type ControlledObject,
  type ProgramNode,
} from "../timeline/timeline-data";
import { isAdditiveClick } from "../timeline/suppress-click";
import {
  planShapeTransition,
  TRANSITION_TIMINGS,
  type ShapeTransitionPlan,
  type TransitionTiming,
} from "../shape-transition";
import { ForcedTrajectoryBadge, isForcedTrajectory } from "../../forced-trajectory-badge";
import { LoopBadge } from "../../loop-badge";
import { writeLibraryDrag, writeSequenceRefDrag } from "./library-dnd";
import { ClipboardContextMenu } from "../action-clipboard-menu";
import { SequenceRenameDialog } from "./sequence-rename-dialog";
import { useGoToSequence } from "../go-to-sequence";

type LibraryEntry = { kind: "sequence"; sequence: ActionSequenceConfig };

/** 按编辑器里看到的内容（有草稿用草稿）判断 */
const sequenceNeedsRepair = (
  sequence: ActionSequenceConfig,
  document: ProjectDocument | null | undefined,
): boolean => {
  if (sequence.blocks.length === 0) return true;
  if (!document) return false;
  return getSequenceContentRepairIssue(document, sequence) !== null;
};

const sequenceDurationMs = (sequence: ActionSequenceConfig): number => {
  try {
    return resolveActionSequence(sequence).totalMs;
  } catch {
    return 0;
  }
};

const LONG_PRESS_MS = 500;

const objectNames = (ids: readonly number[], objectOf: (id: number) => ControlledObject | undefined): string =>
  ids.map((id) => objectOf(id)?.name ?? `模型 ${id}`).join("、");

/** 过渡怎么走的一句话：同时到达时总时长和最慢的那台，各自最快时最晚到的那台 */
const transitionSummary = (
  plan: ShapeTransitionPlan,
  timing: TransitionTiming,
  objectOf: (id: number) => ControlledObject | undefined,
): string => {
  const slowest = plan.slowestObjectId === null ? "" : objectNames([plan.slowestObjectId], objectOf);
  return timing === "sync"
    ? `最快一起到达 ${formatTime(plan.totalMs)} s · 最慢：${slowest}`
    : `各自最快，最晚 ${formatTime(plan.totalMs)} s 到（${slowest}）`;
};

/**
 * 选了两个序列（Ctrl/⌘ 点）：前一个结束时的样子到后一个开始时的样子怎么过渡、最快多久，一键生成过渡序列。
 */
const TransitionPanel = ({
  pair,
  sequences,
  objectOf,
  canEdit,
  onSwap,
  onClose,
  onCreate,
}: {
  pair: readonly number[];
  sequences: readonly ActionSequenceConfig[];
  objectOf: (id: number) => ControlledObject | undefined;
  canEdit: boolean;
  onSwap: () => void;
  onClose: () => void;
  onCreate: (fromId: number, toId: number, timing: TransitionTiming) => void;
}) => {
  const [timing, setTiming] = useState<TransitionTiming>("sync");
  const [fromId, toId] = pair;
  const from = sequences.find((sequence) => sequence.id === fromId);
  const to = sequences.find((sequence) => sequence.id === toId);
  const computed = useMemo(() => {
    if (!from || !to) return null;
    try {
      return {
        plan: planShapeTransition({
          from: sequenceShape(resolveActionSequence(from), "end"),
          to: sequenceShape(resolveActionSequence(to), "start"),
          objectOf,
          timing,
        }),
      };
    } catch {
      return { error: "有序列待修复，算不了过渡" };
    }
  }, [from, to, objectOf, timing]);

  if (!from) return null;
  if (!to) {
    return (
      <section aria-label="两个造型之间的过渡" className="shrink-0 border-t border-border/40 bg-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-body-sm text-muted-foreground">
            从「{from.name}」过渡：再 Ctrl+点一个序列
          </p>
          <button
            type="button"
            aria-label="取消过渡"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </section>
    );
  }
  const plan = computed && "plan" in computed ? computed.plan : null;
  const moving = plan?.objects.some((object) => object.durationMs > 0) ?? false;
  const byDefault = plan?.objects.filter((object) => object.basis === "default").map((object) => object.objectId) ?? [];
  const unknown = plan?.objects.filter((object) => object.basis === "unknown").map((object) => object.objectId) ?? [];
  const notes = [
    byDefault.length > 0 ? `${objectNames(byDefault, objectOf)} 没配速度上限，按默认速度算` : null,
    unknown.length > 0 ? `${objectNames(unknown, objectOf)} 没配速度，先按 3 s，生成后再改` : null,
    plan && plan.onlyFrom.length > 0 ? `${objectNames(plan.onlyFrom, objectOf)} 只在「${from.name}」里，不动` : null,
    plan && plan.onlyTo.length > 0 ? `${objectNames(plan.onlyTo, objectOf)} 只在「${to.name}」里，不动` : null,
  ].filter((note): note is string => note !== null);

  return (
    <section aria-label="两个造型之间的过渡" className="shrink-0 border-t border-border/40 bg-muted px-3 py-2">
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-body-sm text-foreground">
          「{from.name}」→「{to.name}」
        </p>
        <button
          type="button"
          aria-label="调换先后"
          title="调换先后"
          onClick={onSwap}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="取消过渡"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div role="group" aria-label="过渡怎么走" className="mt-1 flex gap-1">
        {TRANSITION_TIMINGS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={timing === item.id}
            onClick={() => setTiming(item.id)}
            className={cn(
              "h-7 flex-1 rounded-md text-body-sm",
              timing === item.id ? "bg-accent font-semibold text-primary" : "bg-input-background text-foreground hover:bg-accent",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p role="status" className="mt-1.5 font-mono text-mono-sm tabular-nums text-foreground">
        {computed && "error" in computed
          ? computed.error
          : !plan || plan.objects.length === 0
            ? "两个序列没有共同的物体"
            : moving
              ? transitionSummary(plan, timing, objectOf)
              : "两个造型一样，不用过渡"}
      </p>
      {notes.map((note) => (
        <p key={note} className="text-body-sm text-muted-foreground">
          {note}
        </p>
      ))}
      {canEdit ? (
        <button
          type="button"
          disabled={!moving}
          onClick={() => onCreate(from.id, to.id, timing)}
          className="mt-2 h-8 w-full rounded-md bg-primary text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          生成过渡
        </button>
      ) : null}
    </section>
  );
};

const collectChapters = (programs: ProgramNode[]): ProgramNode[] =>
  programs.flatMap((program) =>
    (program.children ?? []).filter((node) => node.type === "chapter"),
  );

export const ContentLibraryPanel = ({ className }: { className?: string }) => {
  const {
    sequences,
    draftSequenceIds,
    dockMode,
    selectedSequenceId,
    programs,
    selectedObjectIds,
    handleSequenceSelect,
    handleCreateSequence,
    handleProgramItemInsert,
    canPasteSequence,
    handleSequenceCopy,
    handleSequencePaste,
    getTimelineObject,
    handleCreateTransition,
    handleInsertSequenceRef,
  } = useActionBuilder();
  const { currentProject } = useProject();
  const document = currentProject?.document;
  // 新建、改名、粘贴要「编辑动作序列」；拖进章节 / 推子、添加到章节要「节目编排」；浏览、复制、预览人人可用
  const { can } = usePermissions();
  const canEdit = can("action.edit");
  const canProgram = can("program.edit");
  // 「去这里」会让设备动：和 GO 一样要「手动运动」
  const canMove = can("control.manual");
  const goToSequence = useGoToSequence();

  const [search, setSearch] = useState("");
  const [chapterMenuFor, setChapterMenuFor] = useState<number | null>(null);
  /** 右键点到的序列；点在空白处为 null */
  const [menuSequenceId, setMenuSequenceId] = useState<number | null>(null);
  /** 正在重命名的序列 */
  const [renameSequenceId, setRenameSequenceId] = useState<number | null>(null);
  /** Ctrl/⌘ 点选的两个序列：前一个结束时到后一个开始时的过渡 */
  const [transitionPair, setTransitionPair] = useState<number[]>([]);
  const pair = transitionPair.filter((id) => sequences.some((sequence) => sequence.id === id));
  const longPressRef = useRef<number | null>(null);

  const chapters = useMemo(() => collectChapters(programs), [programs]);

  const entries = useMemo((): LibraryEntry[] => {
    const term = search.trim().toLowerCase();
    return sequences
      .map((sequence): LibraryEntry => ({ kind: "sequence", sequence }))
      .filter((entry) => !term || entry.sequence.name.toLowerCase().includes(term));
  }, [sequences, search]);

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleRowPointerDown = (entry: LibraryEntry) => (_event: PointerEvent) => {
    clearLongPress();
    if (!canProgram) return;
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      setChapterMenuFor(entry.sequence.id);
    }, LONG_PRESS_MS);
  };

  /** Ctrl/⌘ 点：加进过渡的两个序列（已打开着别的序列时，打开的那个当起点） */
  const togglePair = (id: number) =>
    setTransitionPair((current) => {
      const kept = current.filter((item) => sequences.some((sequence) => sequence.id === item));
      if (kept.includes(id)) return kept.filter((item) => item !== id);
      const opened =
        kept.length === 0 && dockMode === "sequence" && selectedSequenceId !== null && selectedSequenceId !== id
          ? [selectedSequenceId]
          : kept;
      return [...opened, id].slice(-2);
    });

  const handleRowClick = (entry: LibraryEntry, event?: MouseEvent<HTMLElement>) => {
    if (chapterMenuFor) {
      setChapterMenuFor(null);
      return;
    }
    if (event && isAdditiveClick(event)) {
      togglePair(entry.sequence.id);
      return;
    }
    if (dockMode === "sequence" && selectedSequenceId === entry.sequence.id) {
      handleSequenceSelect(null);
      return;
    }
    handleSequenceSelect(entry.sequence.id);
  };

  // 拖进节目章节要「节目编排」；拖到时间轴上引用要「编辑动作序列」
  const handleRowDragStart = (entry: LibraryEntry) => (event: DragEvent) => {
    clearLongPress();
    setChapterMenuFor(null);
    if (canProgram) writeLibraryDrag(event.dataTransfer, { kind: "sequence", id: entry.sequence.id });
    if (canEdit) writeSequenceRefDrag(event.dataTransfer, entry.sequence.id);
  };

  const sequenceIdAt = (target: EventTarget | null): number | null => {
    const row =
      target instanceof Element ? target.closest<HTMLElement>("[data-sequence-id]") : null;
    const id = row ? Number(row.dataset.sequenceId) : NaN;
    return Number.isFinite(id) ? id : null;
  };

  const handleListContextMenu = (event: MouseEvent<HTMLElement>) => {
    clearLongPress();
    setMenuSequenceId(sequenceIdAt(event.target));
  };

  const menuSequence = sequences.find((sequence) => sequence.id === menuSequenceId);

  const renderChapterMenu = (entry: LibraryEntry) => (
    <div
      role="menu"
      aria-label="添加到章节"
      className="absolute left-8 right-2 top-full z-50 mt-1 rounded-md bg-card py-1 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      <p className="px-3 py-1 text-label-caps text-muted-foreground">添加到章节</p>
      {chapters.length === 0 && (
        <p className="px-3 py-1.5 text-body-sm text-muted-foreground">暂无章节，请先在节目管理中新建</p>
      )}
      {chapters.map((chapter) => (
        <button
          key={chapter.id}
          type="button"
          role="menuitem"
          onClick={(event) => {
            event.stopPropagation();
            handleProgramItemInsert(
              chapter.id,
              { kind: "sequence", refId: entry.sequence.id },
            );
            setChapterMenuFor(null);
          }}
          className="flex w-full px-3 py-2 text-left text-body-sm text-foreground hover:bg-muted"
        >
          {chapter.name}
        </button>
      ))}
    </div>
  );

  const renderRow = (entry: LibraryEntry) => {
    const id = entry.sequence.id;
    const needsRepair = sequenceNeedsRepair(entry.sequence, document);
    const unsaved = draftSequenceIds.has(id);
    const selected = dockMode === "sequence" && selectedSequenceId === id;
    const forced = isForcedTrajectory(entry.sequence.trajectoryMode);
    const loop = entry.sequence.loop === true;
    const rowLabel = [
      entry.sequence.name,
      forced ? "强制轨迹" : null,
      loop ? "循环" : null,
      unsaved ? "未保存" : null,
      needsRepair ? "待修复" : null,
    ]
      .filter(Boolean)
      .join("，");

    return (
      <div key={`${entry.kind}:${id}`} className="relative">
        <div
          role="button"
          tabIndex={0}
          data-sequence-id={id}
          aria-label={rowLabel}
          aria-pressed={selected}
          draggable={canProgram || canEdit}
          onDragStart={canProgram || canEdit ? handleRowDragStart(entry) : undefined}
          onPointerDown={handleRowPointerDown(entry)}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onClick={(event) => handleRowClick(entry, event)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleRowClick(entry);
            }
          }}
          className={cn(
            "flex min-h-[44px] w-full cursor-pointer items-center gap-2 border-l-2 px-2 py-1.5 text-left transition-colors",
            selected
              ? "border-l-primary bg-muted"
              : "border-l-transparent hover:bg-muted/30",
          )}
        >
          <ListClock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {pair.includes(id) ? (
            <span
              aria-label={pair[0] === id ? "过渡起点" : "过渡终点"}
              className="shrink-0 rounded-sm bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {pair[0] === id ? "从" : "到"}
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p
                title={selected && canEdit ? "点击重命名" : undefined}
                // 已选中的序列点名字重命名，不取消选中
                onClick={(event) => {
                  if (!selected || chapterMenuFor || !canEdit) return;
                  event.stopPropagation();
                  setRenameSequenceId(id);
                }}
                className={cn(
                  "min-w-0 truncate text-body-sm",
                  selected ? cn("font-medium text-primary", canEdit && "cursor-text") : "text-foreground/90",
                )}
              >
                {entry.sequence.name}
              </p>
              {forced ? <ForcedTrajectoryBadge /> : null}
              {loop ? <LoopBadge /> : null}
            </div>
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {`${formatDurationSeconds(sequenceDurationMs(entry.sequence))} · ${countSequenceBlocks(entry.sequence)} 块`}
              {unsaved ? (
                <span className="ml-1.5 font-sans text-body-sm text-warning">未保存</span>
              ) : null}
              {needsRepair ? (
                <span className="ml-1.5 font-sans text-body-sm text-warning">待修复</span>
              ) : null}
            </p>
          </div>
        </div>

        {chapterMenuFor === id && renderChapterMenu(entry)}
      </div>
    );
  };

  return (
    <aside data-guide="console-action-library" className={cn("flex flex-col overflow-hidden rounded-lg bg-card", className)}>
      <PanelHeader
        title="动作序列库"
        extra={
          canEdit ? (
            <button
              data-guide="console-action-template-create"
              type="button"
              aria-label="新建动作序列"
              onClick={() => handleCreateSequence(selectedObjectIds)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          ) : undefined
        }
      />

      <div className="shrink-0 px-2 py-1.5">
        <div className="flex items-center gap-2 rounded-sm bg-input-background px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            placeholder="搜索…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索动作序列库"
            className="w-full bg-transparent text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <ClipboardContextMenu
        copyLabel={menuSequence ? `复制「${menuSequence.name}」` : "复制"}
        pasteLabel="粘贴为新序列"
        canCopy={menuSequence !== undefined}
        canPaste={canEdit && canPasteSequence}
        onCopy={() => {
          if (menuSequence) handleSequenceCopy(menuSequence.id);
        }}
        onPaste={handleSequencePaste}
        onContextMenu={handleListContextMenu}
        // 序列只走右键菜单；Ctrl+C / V 留给时间轴动作块
        showShortcuts={false}
        actions={[
          ...(canEdit
            ? [
                {
                  label: menuSequence ? `重命名「${menuSequence.name}」` : "重命名",
                  disabled: menuSequence === undefined,
                  onSelect: () => {
                    if (menuSequence) setRenameSequenceId(menuSequence.id);
                  },
                },
              ]
            : []),
          // 正在编另一条序列时：在它的游标处引用这一条（拖到时间轴上也行）
          ...(canEdit && dockMode === "sequence" && selectedSequenceId !== null
            ? [
                {
                  label: menuSequence ? `在游标处引用「${menuSequence.name}」` : "在游标处引用",
                  disabled: menuSequence === undefined || menuSequence.id === selectedSequenceId,
                  onSelect: () => {
                    if (menuSequence) handleInsertSequenceRef(menuSequence.id);
                  },
                },
              ]
            : []),
          ...(canMove && goToSequence
            ? [
                {
                  label: menuSequence ? `去「${menuSequence.name}」的起点` : "去这里",
                  disabled: menuSequence === undefined,
                  onSelect: () => {
                    if (menuSequence) goToSequence?.(menuSequence);
                  },
                },
              ]
            : []),
        ]}
      >
        <div
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          role="listbox"
          aria-label="动作序列库列表"
          tabIndex={-1}
        >
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
              {search ? "没有匹配的内容" : canEdit ? "暂无内容，选中物体后从右上角新建" : "暂无内容"}
            </p>
          ) : (
            entries.map(renderRow)
          )}
        </div>
      </ClipboardContextMenu>
      {pair.length > 0 ? (
        <TransitionPanel
          pair={pair}
          sequences={sequences}
          objectOf={getTimelineObject}
          canEdit={canEdit}
          onSwap={() => setTransitionPair((current) => [...current].reverse())}
          onClose={() => setTransitionPair([])}
          onCreate={(fromId, toId, timing) => {
            if (handleCreateTransition(fromId, toId, timing)) setTransitionPair([]);
          }}
        />
      ) : null}
      <SequenceRenameDialog
        open={renameSequenceId !== null}
        onOpenChange={(open) => {
          if (!open) setRenameSequenceId(null);
        }}
        sequenceId={renameSequenceId}
      />
    </aside>
  );
};
