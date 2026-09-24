import { cn } from "@/app/components/ui/utils";

type ProjectMismatchDialogProps = {
  open: boolean;
  onCancel: () => void;
  onCloseProject: () => void;
  onDownload: () => void;
};

export const ProjectMismatchDialog = ({
  open,
  onCancel,
  onCloseProject,
  onDownload,
}: ProjectMismatchDialogProps) => {
  if (!open) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm",
      )}
    >
      <div className="w-[420px] rounded-md border border-border bg-card p-5 shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <h2 className="text-heading-md font-semibold text-foreground">工程不匹配</h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          主控的工程与当前工程不匹配，是否下载当前工程到主控？
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            aria-label="取消"
            onClick={onCancel}
            className="h-10 rounded-sm border border-border bg-background px-4 text-body-md text-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onCloseProject}
            className="h-10 rounded-sm border border-border bg-background px-4 text-body-md text-foreground hover:bg-muted"
          >
            关闭工程
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="h-10 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            下载
          </button>
        </div>
      </div>
    </div>
  );
};
