import { useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { ListClock, Plus, Search } from "lucide-react";
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
  formatTime,
  type ProgramNode,
} from "../timeline/timeline-data";
import { writeLibraryDrag } from "./library-dnd";

type LibraryEntry = { kind: "sequence"; sequence: ActionSequenceConfig };

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

const collectChapters = (programs: ProgramNode[]): ProgramNode[] =>
  programs.flatMap((program) =>
    (program.children ?? []).filter((node) => node.type === "chapter"),
  );

export const ContentLibraryPanel = ({ className }: { className?: string }) => {
  const {
    sequences,
    dockMode,
    selectedSequenceId,
    programs,
    selectedObjectIds,
    handleSequenceSelect,
    handleCreateSequence,
    handleProgramItemInsert,
  } = useActionBuilder();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const [search, setSearch] = useState("");
  const [chapterMenuFor, setChapterMenuFor] = useState<number | null>(null);
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
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      setChapterMenuFor(entry.sequence.id);
    }, LONG_PRESS_MS);
  };

  const handleRowClick = (entry: LibraryEntry) => {
    if (chapterMenuFor) {
      setChapterMenuFor(null);
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
    writeLibraryDrag(event.dataTransfer, { kind: "sequence", id: entry.sequence.id });
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
    const selected = dockMode === "sequence" && selectedSequenceId === id;
    const rowLabel = needsRepair ? `${entry.sequence.name}，待修复` : entry.sequence.name;

    return (
      <div key={`${entry.kind}:${id}`} className="relative">
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel}
          aria-pressed={selected}
          draggable
          onDragStart={handleRowDragStart(entry)}
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
              : "border-l-transparent hover:bg-muted/30",
          )}
        >
          <ListClock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-body-sm",
                selected ? "font-medium text-primary" : "text-foreground/90",
              )}
            >
              {entry.sequence.name}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {`${formatTime(sequenceDurationMs(entry.sequence))} · ${countSequenceBlocks(entry.sequence)} 块`}
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
    <aside className={cn("flex flex-col overflow-hidden rounded-lg bg-card", className)}>
      <PanelHeader
        title="动作序列库"
        extra={
          <button
            type="button"
            aria-label="新建动作序列"
            onClick={() => handleCreateSequence(selectedObjectIds)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
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

      <div
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto py-1"
        role="listbox"
        aria-label="动作序列库列表"
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
