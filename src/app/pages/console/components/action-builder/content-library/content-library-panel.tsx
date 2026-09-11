import { useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { ArrowLeftRight, Diamond, Eye, ListClock, Plus, Search, X } from "lucide-react";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { cn } from "@/app/components/ui/utils";
import { useActionBuilder } from "../use-action-builder";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import type { ProjectDocument } from "@/app/project/project-document-types";
import {
  countSequenceBlocks,
  cueObjectIds,
  cueObjectSetsMatch,
  formatTime,
  type CueItem,
  type ProgramNode,
} from "../timeline/timeline-data";
import { isLibraryDrag, readLibraryDrag, writeLibraryDrag } from "./library-dnd";

type LibraryFilter = "all" | "cue" | "sequence";

type LibraryEntry =
  | { kind: "cue"; cue: CueItem }
  | { kind: "sequence"; sequence: ActionSequenceConfig };

const FILTER_TABS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "cue", label: "Cue" },
  { id: "sequence", label: "动作" },
];

const sequenceNeedsRepair = (
  sequence: ActionSequenceConfig,
  document: ProjectDocument | null | undefined,
): boolean => {
  if (sequence.blocks.length === 0) return true;
  if (!document) return false;
  return getMotionItemRepairIssue(document, "sequence", sequence.id) !== null;
};

const sequenceDurationMs = (sequence: ActionSequenceConfig): number => {
  try {
    return resolveActionSequence(sequence).totalMs;
  } catch {
    return 0;
  }
};

const LONG_PRESS_MS = 500;

const entryId = (entry: LibraryEntry): string | number =>
  entry.kind === "cue" ? entry.cue.id : entry.sequence.id;

const entryName = (entry: LibraryEntry): string =>
  entry.kind === "cue" ? entry.cue.name : entry.sequence.name;

const collectChapters = (programs: ProgramNode[]): ProgramNode[] =>
  programs.flatMap((program) =>
    (program.children ?? []).filter((node) => node.type === "chapter"),
  );

export const ContentLibraryPanel = ({ className }: { className?: string }) => {
  const {
    cues,
    sequences,
    dockMode,
    selectedCueId,
    selectedSequenceId,
    combineFromCueId,
    programs,
    selectedObjectIds,
    handleCueSelect,
    handleSequenceSelect,
    handleCuePreview,
    handleCombineStart,
    handleGenerateTransition,
    handleCreateCue,
    handleCreateSequence,
    handleProgramItemInsert,
  } = useActionBuilder();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [chapterMenuFor, setChapterMenuFor] = useState<string | number | null>(null);
  const longPressRef = useRef<number | null>(null);

  const chapters = useMemo(() => collectChapters(programs), [programs]);
  const combineFromCue = combineFromCueId
    ? cues.find((cue) => cue.id === combineFromCueId) ?? null
    : null;

  const entries = useMemo((): LibraryEntry[] => {
    const all: LibraryEntry[] = [
      ...cues.map((cue): LibraryEntry => ({ kind: "cue", cue })),
      ...sequences.map((sequence): LibraryEntry => ({ kind: "sequence", sequence })),
    ];
    const term = search.trim().toLowerCase();
    return all.filter((entry) => {
      if (filter !== "all" && entry.kind !== filter) return false;
      if (term && !entryName(entry).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [cues, sequences, filter, search]);

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleRowPointerDown = (entry: LibraryEntry) => (_event: PointerEvent) => {
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      setChapterMenuFor(entryId(entry));
    }, LONG_PRESS_MS);
  };

  const handleRowClick = (entry: LibraryEntry) => {
    if (chapterMenuFor) {
      setChapterMenuFor(null);
      return;
    }
    if (entry.kind === "cue") {
      if (combineFromCue && combineFromCue.id !== entry.cue.id) {
        if (cueObjectSetsMatch(combineFromCue, entry.cue)) {
          handleGenerateTransition(combineFromCue.id, entry.cue.id);
        }
        return;
      }
      if (dockMode === "cue" && selectedCueId === entry.cue.id) {
        handleCueSelect(null);
        return;
      }
      handleCueSelect(entry.cue.id);
      handleCuePreview(entry.cue.id);
      return;
    }
    if (dockMode === "sequence" && selectedSequenceId === entry.sequence.id) {
      handleSequenceSelect(null);
      return;
    }
    handleSequenceSelect(entry.sequence.id);
  };

  const handleRowDragStart = (entry: LibraryEntry) => (event: DragEvent) => {
    clearLongPress();
    setChapterMenuFor(null);
    writeLibraryDrag(
      event.dataTransfer,
      entry.kind === "cue"
        ? { kind: "cue", id: entry.cue.id }
        : { kind: "sequence", id: entry.sequence.id },
    );
  };

  const handleCueRowDragOver = (cue: CueItem) => (event: DragEvent) => {
    if (!isLibraryDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleCueRowDrop = (cue: CueItem) => (event: DragEvent) => {
    const payload = readLibraryDrag(event.dataTransfer);
    if (!payload || payload.kind !== "cue" || payload.id === cue.id) return;
    event.preventDefault();
    handleGenerateTransition(payload.id, cue.id);
  };

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
              entry.kind === "cue"
                ? { kind: "cue", refId: entry.cue.id }
                : { kind: "sequence", refId: entry.sequence.id },
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
    const id = entryId(entry);
    const isCue = entry.kind === "cue";
    const needsRepair = isCue
      ? Object.keys(entry.cue.targets).length === 0
      : sequenceNeedsRepair(entry.sequence, document);
    const selected = isCue
      ? dockMode === "cue" && selectedCueId === id
      : dockMode === "sequence" && selectedSequenceId === id;
    const isCombineFrom = isCue && combineFromCueId === id;
    const combineCandidate =
      isCue && combineFromCue && combineFromCue.id !== id
        ? cueObjectSetsMatch(combineFromCue, entry.cue)
        : null;
    const rowLabel = needsRepair ? `${entryName(entry)}，待修复` : entryName(entry);

    return (
      <div
        key={`${entry.kind}:${id}`}
        className={cn("relative", combineCandidate === false && "opacity-40")}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel}
          aria-pressed={selected}
          draggable
          onDragStart={handleRowDragStart(entry)}
          onDragOver={isCue ? handleCueRowDragOver(entry.cue) : undefined}
          onDrop={isCue ? handleCueRowDrop(entry.cue) : undefined}
          onPointerDown={handleRowPointerDown(entry)}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onClick={() => handleRowClick(entry)}
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
              : isCombineFrom
                ? "border-l-primary bg-primary/10"
                : combineCandidate === true
                  ? "border-l-transparent bg-input-background hover:bg-primary/10"
                  : "border-l-transparent hover:bg-muted/30",
          )}
        >
          {isCue ? (
            <Diamond className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          ) : (
            <ListClock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          )}

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-body-sm",
                selected ? "font-medium text-primary" : "text-foreground/90",
              )}
            >
              {entryName(entry)}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {isCue
                ? `${cueObjectIds(entry.cue).length} 物体`
                : `${formatTime(sequenceDurationMs(entry.sequence))} · ${countSequenceBlocks(entry.sequence)} 块`}
              {needsRepair ? (
                <span className="ml-1.5 font-sans text-body-sm text-warning">待修复</span>
              ) : null}
            </p>
          </div>

          {isCue && (
            <>
              <button
                type="button"
                aria-label={`预览 ${entry.cue.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleCuePreview(entry.cue.id);
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-primary"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={
                  isCombineFrom ? "取消组合起点" : `以 ${entry.cue.name} 为起点组合过渡`
                }
                aria-pressed={isCombineFrom}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isCombineFrom) {
                    handleCombineStart(null);
                    return;
                  }
                  if (combineFromCue && combineCandidate === true) {
                    handleGenerateTransition(combineFromCue.id, entry.cue.id);
                    return;
                  }
                  handleCombineStart(entry.cue.id);
                }}
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm",
                  isCombineFrom
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>

        {chapterMenuFor === id && renderChapterMenu(entry)}
      </div>
    );
  };

  return (
    <aside className={cn("flex flex-col overflow-hidden rounded-lg bg-card", className)}>
      <PanelHeader
        title="内容库"
        extra={
          <div className="relative">
            <button
              type="button"
              aria-label="新建内容"
              aria-expanded={createMenuOpen}
              aria-haspopup="menu"
              onClick={() => setCreateMenuOpen((current) => !current)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            {createMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-md bg-card py-1 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleCreateCue(selectedObjectIds);
                    setCreateMenuOpen(false);
                  }}
                  className="flex w-full px-3 py-2 text-left text-body-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground"
                >
                  新建 Cue
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleCreateSequence(selectedObjectIds);
                    setCreateMenuOpen(false);
                  }}
                  className="flex w-full px-3 py-2 text-left text-body-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground"
                >
                  新建动作序列
                </button>
              </div>
            )}
          </div>
        }
      />

      <div className="flex h-9 shrink-0 bg-card" role="tablist" aria-label="内容筛选">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              "relative h-9 flex-1 text-body-sm transition-colors",
              filter === tab.id
                ? "font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {filter === tab.id && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />
            )}
          </button>
        ))}
      </div>

      <div className="shrink-0 px-2 py-1.5">
        <div className="flex items-center gap-2 rounded-sm bg-input-background px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            type="search"
            placeholder="搜索…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索内容库"
            className="w-full bg-transparent text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {combineFromCue && (
        <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-body-sm text-primary">
            {combineFromCue.name} → 请选择物体一致的 Cue
          </p>
          <button
            type="button"
            aria-label="取消组合"
            onClick={() => handleCombineStart(null)}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-primary hover:bg-primary/20"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1"
        role="listbox"
        aria-label="内容库列表"
      >
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
            {search ? "没有匹配的内容" : "暂无内容，选中物体后从右上角新建"}
          </p>
        ) : (
          entries.map(renderRow)
        )}
      </div>
    </aside>
  );
};
