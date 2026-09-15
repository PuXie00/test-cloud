import { useMemo, useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { cn } from "@/app/components/ui/utils";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import {
  getProgramRepairIssues,
  resolveMotionLaunchBlock,
} from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useExecCards } from "../../hooks/use-exec-cards";
import { startLocalAuthoredSequence } from "../../hooks/sequence-execution";
import type { ProgramItemInput } from "../action-builder/action-builder-context-types";
import {
  isLibraryDrag,
  isProgramItemDrag,
  readLibraryDrag,
  readProgramItemDrag,
  sequenceProgramItemFromLibrary,
  writeProgramItemDrag,
} from "../action-builder/content-library/library-dnd";
import { formatTime, type ProgramNode } from "../action-builder/timeline/timeline-data";
import { useActionBuilder } from "../action-builder/use-action-builder";
import { PROGRAM_SLOTS_PER_PAGE } from "./program-data";
import { ProgramPageHeader } from "./program-page-header";
import { ProgramSequenceRow } from "./program-sequence-row";
import { programPageCount } from "./program-utils";

type ItemMeta = { kind: "sequence"; refId: number; name: string; durationMs: number | null };

type AuthoredChapterSectionProps = {
  chapter: ProgramNode;
  itemMetaById: Map<string, ItemMeta>;
  onInsert: (chapterId: string, item: ProgramItemInput, index?: number) => void;
  onRemove: (chapterId: string, index: number) => void;
  onMove: (chapterId: string, fromIndex: number, toIndex: number) => void;
  onLaunch: (meta: ItemMeta) => void;
};

const AuthoredPageSection = ({
  chapterId,
  pageIndex,
  pageTotal,
  items,
  itemIndexOffset,
  itemMetaById,
  dragOverIndex,
  acceptDrag,
  setDragOverIndex,
  handleDropAt,
  onLaunch,
  onRemove,
}: {
  chapterId: string;
  pageIndex: number;
  pageTotal: number;
  items: ProgramNode[];
  itemIndexOffset: number;
  itemMetaById: Map<string, ItemMeta>;
  dragOverIndex: number | null;
  acceptDrag: (event: DragEvent) => boolean;
  setDragOverIndex: Dispatch<SetStateAction<number | null>>;
  handleDropAt: (index: number) => (event: DragEvent) => void;
  onLaunch: (meta: ItemMeta) => void;
  onRemove: (chapterId: string, index: number) => void;
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex flex-col">
      <ProgramPageHeader
        pageIndex={pageIndex}
        pageTotal={pageTotal}
        isCurrent={false}
        expanded={expanded}
        onToggle={(event) => {
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        onSelect={() => setExpanded(true)}
      />
      {expanded &&
        items.map((item, pageItemIndex) => {
          const index = itemIndexOffset + pageItemIndex;
          const meta = itemMetaById.get(`${item.type}:${item.id}`);
          const name = meta?.name ?? item.name;
          return (
            <ProgramSequenceRow
              key={`${chapterId}:${index}:${item.id}`}
              name={name}
              indexLabel={String(index + 1)}
              durationLabel={
                meta && meta.durationMs !== null ? formatTime(meta.durationMs) : null
              }
              draggable
              dropActive={dragOverIndex === index}
              striped={pageItemIndex % 2 !== 0}
              onDragStart={(event) =>
                writeProgramItemDrag(event.dataTransfer, { chapterId, index })
              }
              onDragOver={(event) => {
                if (acceptDrag(event)) setDragOverIndex(index);
              }}
              onDragLeave={() =>
                setDragOverIndex((current) => (current === index ? null : current))
              }
              onDrop={handleDropAt(index)}
              onLaunch={() => {
                if (meta) onLaunch(meta);
              }}
              launchDisabled={!meta}
              onRemove={() => onRemove(chapterId, index)}
            />
          );
        })}
    </div>
  );
};

const AuthoredChapterSection = ({
  chapter,
  itemMetaById,
  onInsert,
  onRemove,
  onMove,
  onLaunch,
}: AuthoredChapterSectionProps) => {
  const [expanded, setExpanded] = useState(true);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const items = chapter.children ?? [];
  const totalPages = programPageCount(items);
  const pages = Array.from({ length: totalPages }, (_, pageIndex) =>
    items.slice(pageIndex * PROGRAM_SLOTS_PER_PAGE, (pageIndex + 1) * PROGRAM_SLOTS_PER_PAGE),
  );

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
        onClick={() => setExpanded(true)}
        className="flex h-9 w-full items-center gap-1.5 px-2 text-left text-foreground transition-colors hover:bg-muted"
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          className="flex h-4 w-4 items-center justify-center"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-body-md font-medium text-foreground">
          {chapter.name}
        </span>
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
          {pages.length}页·{items.length}项
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col pb-1">
          {pages.map((pageItems, pageIndex) => (
            <AuthoredPageSection
              key={pageIndex}
              chapterId={chapter.id}
              pageIndex={pageIndex}
              pageTotal={pages.length}
              items={pageItems}
              itemIndexOffset={pageIndex * PROGRAM_SLOTS_PER_PAGE}
              itemMetaById={itemMetaById}
              dragOverIndex={dragOverIndex}
              acceptDrag={acceptDrag}
              setDragOverIndex={setDragOverIndex}
              handleDropAt={handleDropAt}
              onLaunch={onLaunch}
              onRemove={onRemove}
            />
          ))}

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

type AuthoringProgramPanelProps = { className?: string };

export const AuthoringProgramPanel = ({ className }: AuthoringProgramPanelProps) => {
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
        sequenceId: meta.refId,
        sequenceHandle: started.sequenceHandle,
      });
    })();
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
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
              暂无节目。新建章节后，把动作序列库的动作序列拖入章节即可编排。
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
          const programIssues = document ? getProgramRepairIssues(document, program.id) : [];
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
                  <AuthoredChapterSection
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
