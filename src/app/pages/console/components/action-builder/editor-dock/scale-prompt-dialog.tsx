import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";

/** 右键「整体缩放…」：选中的区间从选区起点按比例伸缩 */
export type ScalePrompt = {
  /** 选中块现在从最早到最晚的总时长 */
  durationMs: number;
  segmentCount: number;
  onConfirm: (durationMs: number, shiftAll: boolean) => void;
};

const QUICK_FACTORS = [0.5, 0.8, 1.25, 2] as const;

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

/** 填新的总时长或点倍数，勾选后面没选中的也一起挪；prompt 为 null 时关闭 */
export const ScalePromptDialog = ({
  prompt,
  onClose,
}: {
  prompt: ScalePrompt | null;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState("");
  // 上次的勾选留着，连着缩几次不用每次再勾
  const [shiftAll, setShiftAll] = useState(false);
  const currentSeconds = prompt ? prompt.durationMs / 1000 : 0;

  useEffect(() => {
    if (prompt) setDraft(String(roundTenth(prompt.durationMs / 1000)));
  }, [prompt]);

  const value = roundTenth(Number(draft));
  const valid = prompt !== null && draft.trim() !== "" && Number.isFinite(value) && value >= 0.1;
  const factor = valid && currentSeconds > 0 ? value / currentSeconds : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt || !valid) return;
    prompt.onConfirm(Math.round(value * 1000), shiftAll);
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-[380px]">
        <DialogHeader className="bg-muted px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-heading-md text-foreground">整体缩放</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">
            选中的 {prompt?.segmentCount ?? 0} 段从选区起点按比例伸缩，各台的先后和错峰不变，后面的块跟着挪
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3 bg-background p-4" onSubmit={handleSubmit}>
          <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span className="min-w-0 flex-1">总时长</span>
            <input
              aria-label="总时长"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={0.1}
              value={draft}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              className="h-10 w-28 rounded-md border border-border/60 bg-input-background px-3 text-right font-mono text-body-md tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span>s</span>
          </label>
          <div role="group" aria-label="按倍数" className="flex gap-2">
            {QUICK_FACTORS.map((quick) => {
              const pressed = factor !== null && Math.abs(factor - quick) < 0.005;
              return (
                <button
                  key={quick}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setDraft(String(roundTenth(currentSeconds * quick)))}
                  className={cn(
                    "h-9 flex-1 rounded-md font-mono text-body-sm tabular-nums",
                    pressed ? "bg-accent text-primary" : "bg-input-background text-foreground hover:bg-accent",
                  )}
                >
                  ×{quick}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-body-sm tabular-nums text-muted-foreground">
            {roundTenth(currentSeconds)} s → {valid ? value : "--"} s
            {factor !== null ? `（×${factor.toFixed(2)}）` : ""}
          </p>
          <label className="flex items-center gap-2 text-body-sm text-foreground">
            <input
              type="checkbox"
              checked={shiftAll}
              onChange={(event) => setShiftAll(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            没选中的物体和标记也一起往后挪
          </label>
          {!valid && prompt ? <p className="text-body-sm text-warning">至少 0.1 s</p> : null}
          <div className="flex justify-end gap-2">
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
