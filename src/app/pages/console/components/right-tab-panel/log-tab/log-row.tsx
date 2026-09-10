import { cn } from "@/app/components/ui/utils";
import type { LogEntry, LogLevel } from "./log-data";

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "信息",
  operation: "操作",
  warning: "警告",
  alarm: "报警",
  fault: "故障",
};

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "border-border text-muted-foreground",
  operation: "border-primary/40 text-primary",
  warning: "border-warning/50 text-warning",
  alarm: "border-destructive/50 text-destructive",
  fault: "border-destructive/70 text-destructive font-bold",
};

const formatTime = (ts: number) => {
  const date = new Date(ts);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
};

type LogRowProps = { entry: LogEntry };

export const LogRow = ({ entry }: LogRowProps) => (
  <div className="flex items-start gap-2 border-b border-border/40 px-3 py-1.5">
    <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
      {formatTime(entry.timestamp)}
    </span>
    <span className={cn("shrink-0 rounded-sm border px-1.5 text-label-caps", LEVEL_STYLE[entry.level])}>
      {LEVEL_LABEL[entry.level]}
    </span>
    <span className="min-w-0 flex-1 text-body-sm text-foreground">{entry.message}</span>
  </div>
);
