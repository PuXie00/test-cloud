import { Play, Plus } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import type { FaderSlotState } from "../../../hooks/use-executor-slots";

type FaderSlotProps = {
  slot: FaderSlotState;
  repairMessage?: string | null;
  onGo: () => void;
  onFaderChange: (value: number) => void;
  onAssignFromDrag: (payload: { chapterId: string; index: number; kind: "cue" | "sequence" }) => void;
};

export const FaderSlot = ({
  slot,
  repairMessage,
  onGo,
  onFaderChange,
  onAssignFromDrag,
}: FaderSlotProps) => {
  const { mode } = useConsoleMode();
  const isEmpty = !slot.sequence;
  const isBlocked = isEmpty || Boolean(repairMessage);
  const isRehearsal = mode === "rehearsal";
  const reasonId = `fader-slot-repair-${slot.index}`;

  const handleDragOver = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    if (!event.dataTransfer.types.includes("application/x-console-item")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!isRehearsal) return;
    const raw = event.dataTransfer.getData("application/x-console-item");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      if (payload?.kind !== "sequence") return;
      onAssignFromDrag(payload);
    } catch {
      // ignore
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "flex h-[140px] w-full flex-col gap-1 rounded-sm border bg-card p-2 transition-colors",
        slot.isRunning
          ? "border-show/60"
          : isEmpty
            ? cn("border-dashed border-muted-foreground/40", isRehearsal && "hover:border-primary/40")
            : repairMessage
              ? "border-warning/50"
              : "border-border"
      )}
    >
      <div className="flex items-center gap-1">
        <span className="font-mono text-label-caps text-muted-foreground">{slot.label}</span>
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full",
            slot.isRunning
              ? "bg-show"
              : isEmpty
                ? "bg-muted-foreground/40"
                : repairMessage
                  ? "bg-warning"
                  : "bg-show/70"
          )}
        />
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        <div className="flex flex-col items-center justify-between">
          <input
            type="range"
            min={0}
            max={200}
            value={slot.faderValue}
            disabled={isEmpty}
            onChange={(event) => onFaderChange(Number(event.target.value))}
            className="h-full w-2 -rotate-180 accent-primary disabled:opacity-30"
            style={{ writingMode: "vertical-lr" }}
            aria-label={`${slot.label} 速度`}
          />
          <span className="mt-1 font-mono text-mono-sm tabular-nums text-foreground">
            {slot.faderValue}%
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground/60">
              <Plus className="h-3.5 w-3.5" />
              <span className="mt-0.5 text-body-sm">
                {isRehearsal ? "拖入序列" : "—"}
              </span>
            </div>
          ) : (
            <>
              <span className="line-clamp-2 text-body-sm text-foreground">{slot.sequence?.name}</span>
              {repairMessage ? (
                <span id={reasonId} className="mt-0.5 line-clamp-2 text-body-sm text-warning">
                  {repairMessage}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={isBlocked}
        aria-describedby={repairMessage ? reasonId : undefined}
        onClick={onGo}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-1 rounded-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-30",
          slot.isRunning
            ? "bg-show text-background"
            : isBlocked
              ? "border border-border text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        <Play className="h-3.5 w-3.5 fill-current" aria-hidden /> GO
      </button>
    </div>
  );
};
