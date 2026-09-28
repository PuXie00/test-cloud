import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  SEQUENCE_NAME_MAX_LENGTH,
  sequenceNameError,
} from "@/app/project/action-sequence/sequence-name";
import { useActionBuilder } from "../use-action-builder";

type SequenceRenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const clampDraft = (value: string): string => [...value].slice(0, SEQUENCE_NAME_MAX_LENGTH).join("");

export const SequenceRenameDialog = ({ open, onOpenChange }: SequenceRenameDialogProps) => {
  const { sequence, sequences, handleRenameSequence } = useActionBuilder();
  const [draft, setDraft] = useState(sequence?.name ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(sequence?.name ?? "");
    setSubmitError(null);
  }, [open, sequence?.name]);

  const others = (sequences ?? []).filter((item) => item.id !== sequence?.id).map((item) => item.name);
  const error = submitError ?? sequenceNameError(draft, others);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextError = sequenceNameError(draft, others);
    if (nextError) {
      setSubmitError(nextError);
      return;
    }
    if (!handleRenameSequence) {
      setSubmitError("重命名失败");
      return;
    }
    const failed = handleRenameSequence(draft);
    if (failed) {
      setSubmitError(failed);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-[360px]">
        <DialogHeader className="bg-muted px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-heading-md text-foreground">修改序列名</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">
            不超过 8 个字符，且不能与其他序列重名
          </DialogDescription>
        </DialogHeader>
        <form className="bg-background p-4" onSubmit={handleSubmit}>
          <label htmlFor="sequence-name" className="mb-1 block text-body-sm text-muted-foreground">
            序列名
          </label>
          <input
            id="sequence-name"
            aria-label="序列名"
            value={draft}
            autoFocus
            onChange={(event) => {
              setSubmitError(null);
              setDraft(clampDraft(event.target.value));
            }}
            className="h-10 w-full rounded-md border border-border/60 bg-input-background px-3 text-body-md text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? <p className="mt-2 text-body-sm text-warning">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={error !== null}
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
