import { ArrowLeft, FolderOpen, Plus, Search } from "lucide-react";
import { Input } from "@/app/components/ui/input";

type ProjectCenterHeaderProps = {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  showBack?: boolean;
  backLabel?: string;
  onBack?: () => void;
  onOpenFile: () => void;
  onNewProject: () => void;
};

export const ProjectCenterHeader = ({
  searchQuery,
  onSearchChange,
  showBack = false,
  backLabel = "返回控制台",
  onBack,
  onOpenFile,
  onNewProject,
}: ProjectCenterHeaderProps) => (
  <header className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border bg-muted/40 px-6">
    <div className="flex min-w-0 items-center gap-4 justify-self-start">
      {showBack && onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex shrink-0 items-center gap-2 text-body-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </button>
      ) : null}
      <h1 className="shrink-0 text-heading-xl font-bold text-foreground">工程中心</h1>
    </div>

    <div className="relative w-full max-w-[320px] justify-self-center">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-10 w-full pl-10"
        placeholder="搜索工程..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>

    <div className="flex shrink-0 items-center justify-end gap-3 justify-self-end">
      <button
        type="button"
        onClick={onOpenFile}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-body-sm text-foreground hover:bg-muted"
      >
        <FolderOpen className="h-4 w-4" aria-hidden />
        导入工程
      </button>
      <button
        type="button"
        onClick={onNewProject}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        新建工程
      </button>
    </div>
  </header>
);
