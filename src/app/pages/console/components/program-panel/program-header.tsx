import { Plus, Settings } from "lucide-react";
import { useConsoleMode } from "../../hooks/use-console-mode";

type ProgramHeaderProps = {
  programName: string;
  programNote?: string;
  repairWarning?: string | null;
  onAddChapter: () => void;
  onProgramSettings: () => void;
  showChapterActions?: boolean;
};

export const ProgramHeader = ({
  programName,
  programNote,
  repairWarning,
  onAddChapter,
  onProgramSettings,
  showChapterActions = true,
}: ProgramHeaderProps) => {
  const { mode } = useConsoleMode();
  return (
    <div className="border-b border-border bg-muted/30">
      <div className="flex h-9 items-center gap-2 px-3">
        <span className="flex-1 truncate text-label-caps text-foreground">{programName}</span>
        {repairWarning ? (
          <span
            className="shrink-0 text-body-sm text-warning"
            title={repairWarning}
            aria-label={repairWarning}
          >
            待修复
          </span>
        ) : null}
        {mode === "rehearsal" && showChapterActions && (
          <>
            <button
              type="button"
              aria-label="新建章节"
              onClick={onAddChapter}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-border px-2 text-body-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> 章节
            </button>
            <button
              type="button"
              aria-label="节目设置"
              onClick={onProgramSettings}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {programNote && (
        <p className="px-3 pb-2 text-body-sm text-muted-foreground">{programNote}</p>
      )}
    </div>
  );
};
