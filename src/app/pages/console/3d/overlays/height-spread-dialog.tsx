import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { formatLengthFamily } from "@/app/project/display-length-units";
import { formatFactor } from "../sequence-context-menu-model";

/** 右键「高低差 › 按比例…」：以平均高度为中心按比例放大 / 缩小 */
export type HeightSpreadPrompt = {
  /** 现在的高低差（最高减最低，按尺寸盒中心量，米） */
  spreadM: number;
  count: number;
  onConfirm: (factor: number) => void;
};

const QUICK_FACTORS = [0, 0.5, 1.5, 2, -1] as const;
const MAX_FACTOR = 10;

const roundHundredth = (value: number): number => Math.round(value * 100) / 100;

/** 填倍数或点快捷倍数；prompt 为 null 时关闭 */
export const HeightSpreadDialog = ({
  prompt,
  onClose,
}: {
  prompt: HeightSpreadPrompt | null;
  onClose: () => void;
}) => {
  const display = useSessionDisplayLengthUnit();
  const [draft, setDraft] = useState("1.5");

  useEffect(() => {
    if (prompt) setDraft("1.5");
  }, [prompt]);

  const factor = roundHundredth(Number(draft));
  const valid = prompt !== null && draft.trim() !== "" && Number.isFinite(factor) && Math.abs(factor) <= MAX_FACTOR;
  const format = (meters: number) => formatLengthFamily(meters * 1000, "mm", display);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt || !valid) return;
    prompt.onConfirm(factor);
    onClose();
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-[380px]">
        <DialogHeader className="bg-muted px-4 py-3 pr-10 text-left">
          <DialogTitle className="text-heading-md text-foreground">按比例缩放高低差</DialogTitle>
          <DialogDescription className="text-body-sm text-muted-foreground">
            {`选中的 ${prompt?.count ?? 0} 台以平均高度为中心，高低差乘这个倍数：0 拉平，负数上下翻转。改的是游标处的位姿`}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3 bg-background p-4" onSubmit={handleSubmit}>
          <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span className="min-w-0 flex-1">倍数</span>
            <span>×</span>
            <input
              aria-label="倍数"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={-MAX_FACTOR}
              max={MAX_FACTOR}
              value={draft}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              className="h-10 w-28 rounded-md border border-border/60 bg-input-background px-3 text-right font-mono text-body-md tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div role="group" aria-label="快捷倍数" className="flex gap-2">
            {QUICK_FACTORS.map((quick) => {
              const pressed = valid && Math.abs(factor - quick) < 0.005;
              return (
                <button
                  key={quick}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setDraft(String(quick))}
                  className={cn(
                    "h-9 flex-1 rounded-md font-mono text-body-sm tabular-nums",
                    pressed ? "bg-accent text-primary" : "bg-input-background text-foreground hover:bg-accent",
                  )}
                >
                  {formatFactor(quick)}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-body-sm tabular-nums text-muted-foreground">
            高低差 {prompt ? format(prompt.spreadM) : "--"} → {valid && prompt ? format(Math.abs(prompt.spreadM * factor)) : "--"}
            {valid && factor < 0 ? "（上下翻转）" : ""}
          </p>
          {!valid && prompt ? <p className="text-body-sm text-warning">填 −{MAX_FACTOR} 到 {MAX_FACTOR} 之间的数</p> : null}
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
