import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";

/** 右键菜单里要填一个秒数的操作（统一时长、错峰间隔） */
export type SecondsPrompt = {
  title: string;
  description: string;
  /** 输入框前的说明，也是它的名字 */
  label: string;
  initialSeconds: number;
  /** 最小值（秒） */
  min: number;
  onConfirm: (seconds: number) => void;
};

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

/** 填一个秒数（到 0.1 s），按确定才执行；prompt 为 null 时关闭 */
export const SecondsPromptDialog = ({
  prompt,
  onClose,
}: {
  prompt: SecondsPrompt | null;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (prompt) setDraft(String(roundTenth(prompt.initialSeconds)));
  }, [prompt]);

  const value = Number(draft);
  const valid = prompt !== null && draft.trim() !== "" && Number.isFinite(value) && roundTenth(value) >= prompt.min;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt || !valid) return;
    prompt.onConfirm(roundTenth(value));
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-[360px]">
        <DialogHeader className="bg-muted px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-heading-md text-foreground">{prompt?.title}</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">{prompt?.description}</DialogDescription>
        </DialogHeader>
        <form className="bg-background p-4" onSubmit={handleSubmit}>
          <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{prompt?.label}</span>
            <input
              aria-label={prompt?.label}
              type="number"
              inputMode="decimal"
              step={0.1}
              min={prompt?.min}
              value={draft}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              className="h-10 w-28 rounded-md border border-border/60 bg-input-background px-3 text-right font-mono text-body-md tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span>s</span>
          </label>
          {!valid && prompt ? <p className="mt-2 text-body-sm text-warning">至少 {prompt.min} s</p> : null}
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
              disabled={!valid}
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
