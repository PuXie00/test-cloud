import { Play, Plus } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import type { ButtonSlotState } from "../../../hooks/use-executor-slots";

type ButtonSlotProps = {
  slot: ButtonSlotState;
  repairMessage?: string | null;
  onGo: () => void;
  onAssignFromDrag: (payload: { chapterId: string; index: number; kind: "cue" | "sequence" }) => void;
};

export const ButtonSlot = ({
  slot,
  repairMessage,
  onGo,
  onAssignFromDrag,
}: ButtonSlotProps) => {
  const { mode } = useConsoleMode();
  const isEmpty = !slot.cue;
  const isBlocked = isEmpty || Boolean(repairMessage);
  const isRehearsal = mode === "rehearsal";
  const reasonId = `button-slot-repair-${slot.index}`;

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
      if (payload?.kind !== "cue") return;
      onAssignFromDrag(payload);
    } catch {
      // ignore invalid payload
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "flex h-[118px] w-full flex-col gap-1 rounded-sm border bg-card p-2 transition-colors",
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
      <div className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground/60">
            <Plus className="h-3.5 w-3.5" />
            <span className="mt-0.5 text-body-sm">
              {isRehearsal ? "拖入 Cue" : "—"}
            </span>
          </div>
        ) : (
          <>
            <span className="line-clamp-2 text-body-sm text-foreground">{slot.cue?.name}</span>
            {repairMessage ? (
              <span id={reasonId} className="mt-0.5 line-clamp-2 text-body-sm text-warning">
                {repairMessage}
              </span>
            ) : null}
          </>
        )}
      </div>
      <button
        type="button"
        disabled={isBlocked}
        aria-describedby={repairMessage ? reasonId : undefined}
        onClick={onGo}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-1 rounded-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-30",
          slot.isRunning
            ? "bg-show text-background"
            : isBlocked
              ? "border border-border text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
      >
        <Play className="h-4 w-4 fill-current" aria-hidden /> GO
      </button>
    </div>
  );
};
