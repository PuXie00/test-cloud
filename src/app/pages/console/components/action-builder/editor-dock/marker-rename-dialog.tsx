import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import type { TimelineMarker } from "@/app/project/action-sequence/types";
import { MARKER_NAME_MAX_LENGTH, clampMarkerName } from "../marker-ops";
import { formatTime } from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";

type MarkerRenameDialogProps = {
  /** 要改名的标记；null 时关闭 */
  marker: TimelineMarker | null;
  onClose: () => void;
};

/** 标记改名（双击标记、F2、刚加完标记时） */
export const MarkerRenameDialog = ({ marker, onClose }: MarkerRenameDialogProps) => {
  const { handleRenameMarker } = useActionBuilder();
  const [draft, setDraft] = useState(marker?.name ?? "");

  useEffect(() => {
    if (marker) setDraft(marker.name);
  }, [marker]);

  const empty = draft.trim().length === 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!marker || empty) return;
    handleRenameMarker(marker.id, draft);
    onClose();
  };

  return (
    <Dialog open={marker !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-[360px]">
        <DialogHeader className="bg-muted px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-heading-md text-foreground">标记名称</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">
            {marker ? `${formatTime(marker.atMs)} s，` : ""}不超过 {MARKER_NAME_MAX_LENGTH} 个字符
          </DialogDescription>
        </DialogHeader>
        <form className="bg-background p-4" onSubmit={handleSubmit}>
          <input
            aria-label="标记名称"
            value={draft}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(clampMarkerName(event.target.value))}
            className="h-10 w-full rounded-md border border-border/60 bg-input-background px-3 text-body-md text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {empty ? <p className="mt-2 text-body-sm text-warning">名称不能为空</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={empty}
              className="h-10 rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              确定
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
