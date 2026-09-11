import { useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Play, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { cn } from "@/app/components/ui/utils";
import {
  getProgramRepairIssues,
  resolveMotionLaunchBlock,
} from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useExecCards } from "../../../hooks/use-exec-cards";
import { startLocalAuthoredSequence } from "../../../hooks/sequence-execution";
import { useActionBuilder } from "../use-action-builder";
import type { ProgramItemInput } from "../action-builder-context-types";
import {
  isLibraryDrag,
  isProgramItemDrag,
  readLibraryDrag,
  readProgramItemDrag,
  sequenceProgramItemFromLibrary,
  writeProgramItemDrag,
} from "../content-library/library-dnd";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { formatTime, type ProgramNode } from "../timeline/timeline-data";

type ItemMeta = { kind: "sequence"; refId: number; name: string; durationMs: number | null };

type ChapterSectionProps = {
  chapter: ProgramNode;
  itemMetaById: Map<string, ItemMeta>;
  onInsert: (chapterId: string, item: ProgramItemInput, index?: number) => void;
  onRemove: (chapterId: string, index: number) => void;
  onMove: (chapterId: string, fromIndex: number, toIndex: number) => void;
  onLaunch: (meta: ItemMeta) => void;
};

const ChapterSection = ({
  chapter,
  itemMetaById,
  onInsert,
  onRemove,
  onMove,
  onLaunch,
}: ChapterSectionProps) => {
  const [expanded, setExpanded] = useState(true);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const items = chapter.children ?? [];

  const acceptDrag = (event: DragEvent) => {
    if (!isLibraryDrag(event.dataTransfer) && !isProgramItemDrag(event.dataTransfer)) return false;
    event.preventDefault();
    return true;
  };

  const handleDropAt = (index: number) => (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverIndex(null);

    const libraryPayload = readLibraryDrag(event.dataTransfer);
    const programItem = libraryPayload ? sequenceProgramItemFromLibrary(libraryPayload) : null;
    if (programItem) {
      onInsert(chapter.id, programItem, index);
      return;
    }
    const programPayload = readProgramItemDrag(event.dataTransfer);
    if (programPayload && programPayload.chapterId === chapter.id) {
      onMove(chapter.id, programPayload.index, index);
    }
  };

  return (
    <div className="mb-1 rounded-md bg-muted/60">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex h-9 w-full items-center gap-1.5 px-2 text-left hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-body-md font-medium text-foreground">
          {chapter.name}
        </span>
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {items.length} 项
        </span>
      </button>

      {expanded && (
        <div className="pb-1">
          {items.map((item, index) => {
            const meta = itemMetaById.get(`${item.type}:${item.id}`);
            return (
              <div
                key={`${chapter.id}:${index}:${item.id}`}
                draggable
                onDragStart={(event) =>
                  writeProgramItemDrag(event.dataTransfer, { chapterId: chapter.id, index })
                }
                onDragOver={(event) => {
                  if (acceptDrag(event)) setDragOverIndex(index);
                }}
                onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
                onDrop={handleDropAt(index)}
                className={cn(
                  "group mx-1 flex min-h-[40px] cursor-grab items-center gap-2 rounded-sm border-t-2 px-2 transition-colors active:cursor-grabbing",
                  dragOverIndex === index ? "border-t-primary" : "border-t-transparent",
                  index % 2 === 0 ? "bg-input-background" : "bg-accent/40",
                  "hover:bg-accent",
                )}
              >
                <span className="w-5 shrink-0 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <Play className="h-3 w-3 shrink-0 text-show" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body-sm text-foreground">
                  {meta?.name ?? item.name}
                </span>
                {meta && meta.durationMs !== null && (
                  <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
                    {formatTime(meta.durationMs)}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`运行 ${meta?.name ?? item.name}`}
                  disabled={!meta}
                  onClick={() => meta && onLaunch(meta)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-primary/15 hover:text-primary disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`移除 ${meta?.name ?? item.name}`}
                  onClick={() => onRemove(chapter.id, index)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}

          <div
            onDragOver={(event) => {
              if (acceptDrag(event)) setDragOverIndex(items.length);
            }}
            onDragLeave={() =>
              setDragOverIndex((current) => (current === items.length ? null : current))
            }
            onDrop={handleDropAt(items.length)}
            className={cn(
              "mx-1 mt-0.5 flex h-8 items-center justify-center rounded-sm border border-dashed text-body-sm text-muted-foreground transition-colors",
              dragOverIndex === items.length
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60",
            )}
          >
            拖入动作序列（可重复）
          </div>
        </div>
      )}
    </div>
  );
};

/** 节目管理：章节接受内容库拖入、章节内重排、行内运行（引用式，可重复） */
export const ProgramPanel = () => {
  const {
    programs,
    sequences,
    handleChapterAdd,
    handleProgramItemInsert,
    handleProgramItemRemove,
    handleProgramItemMove,
  } = useActionBuilder();
  const { launch } = useExecCards();
  const { currentProject } = useProject();
  const document = currentProject?.document;

  const itemMetaById = useMemo(() => {
    const map = new Map<string, ItemMeta>();
    for (const sequence of sequences) {
      let durationMs = 0;
      try {
        durationMs = resolveActionSequence(sequence).totalMs;
      } catch {
        durationMs = 0;
      }
      map.set(`sequence:${sequence.id}`, {
        kind: "sequence",
        refId: sequence.id,
        name: sequence.name,
        durationMs,
      });
    }
    return map;
  }, [sequences]);

  const handleLaunch = (meta: ItemMeta) => {
    const issue = resolveMotionLaunchBlock(document, meta.kind, meta.refId);
    if (issue) {
      toast.warning(issue.message);
      return;
    }
    if (!document) return;
    void (async () => {
      const started = await startLocalAuthoredSequence({
        document,
        sequenceId: meta.refId,
      });
      if (!started.ok) {
        if (started.toast === "warning") toast.warning(started.message);
        else toast.error(started.message);
        return;
      }
      launch({
        kind: "sequence",
        name: started.name,
        durationMs: null,
        source: { kind: "program" },
        speedPercent: started.speedPercent,
        sequenceHandle: started.sequenceHandle,
      });
    })();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        title="节目管理"
        extra={
          <button
            type="button"
            aria-label="新建章节"
            onClick={handleChapterAdd}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 text-body-sm text-foreground hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            章节
          </button>
        }
      />
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {programs.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-body-sm text-muted-foreground">
              暂无节目。新建章节后，把左侧内容库的动作序列拖入章节即可编排。
            </p>
            <button
              type="button"
              onClick={handleChapterAdd}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              新建章节
            </button>
          </div>
        )}

        {programs.map((program) => {
          const programIssues = document
            ? getProgramRepairIssues(document, program.id)
            : [];
          return (
            <div key={program.id} className="mb-2">
              <p className="flex items-center gap-2 px-1 pb-1 text-label-caps text-muted-foreground">
                <span className="min-w-0 truncate">{program.name}</span>
                {programIssues.length > 0 ? (
                  <span
                    className="shrink-0 text-body-sm text-warning"
                    title={programIssues.map((issue) => issue.message).join("；")}
                    aria-label={programIssues.map((issue) => issue.message).join("；")}
                  >
                    待修复
                  </span>
                ) : null}
              </p>
              {(program.children ?? [])
                .filter((node) => node.type === "chapter")
                .map((chapter) => (
                  <ChapterSection
                    key={chapter.id}
                    chapter={chapter}
                    itemMetaById={itemMetaById}
                    onInsert={handleProgramItemInsert}
                    onRemove={handleProgramItemRemove}
                    onMove={handleProgramItemMove}
                    onLaunch={handleLaunch}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
