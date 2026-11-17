import { useHaState } from "@/app/hot-standby/ha-state-provider";
import { cn } from "@/app/components/ui/utils";
import { summarizeHa, type HaTone } from "./hot-standby-labels";

const PILL: Record<HaTone, string> = {
  ok: "bg-show/10 text-show hover:bg-show/20",
  warn: "bg-warning/10 text-warning hover:bg-warning/20",
  idle: "bg-muted text-muted-foreground hover:bg-muted/80",
};

const DOT: Record<HaTone, string> = {
  ok: "bg-show",
  warn: "bg-warning",
  idle: "bg-muted-foreground",
};

/** 顶栏热备状态：只在热备开着时显示，点开主备热备页 */
export const HotStandbyPill = ({ onOpen }: { onOpen: () => void }) => {
  const state = useHaState();
  if (!state?.enabled) return null;
  const summary = summarizeHa(state);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`主备热备：${summary.label}${state.deviceGate ? ` · ${state.deviceGate}` : ""}`}
      title={state.deviceGate ?? undefined}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-body-sm transition-colors",
        PILL[summary.tone],
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[summary.tone])} aria-hidden />
      <span>{summary.label}</span>
    </button>
  );
};
