import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";

type NewProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void | Promise<void>;
  title?: string;
  submitLabel?: string;
  defaultValue?: string;
};

export const NewProjectDialog = ({
  open,
  onOpenChange,
  onCreate,
  title = "新建工程",
  submitLabel = "创建",
  defaultValue = "",
}: NewProjectDialogProps) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultValue);
      setError(null);
    }
  }, [open, defaultValue]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("请输入工程名称");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
      setName("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <label htmlFor="project-name" className="text-label-caps text-muted-foreground">
            工程名称
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入工程名称"
            disabled={busy}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
          {error && <p className="text-body-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-10 rounded-md border border-border px-4 text-body-sm text-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="h-10 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
