import type { LogRecord } from "@shared/csocket/operation-log";
import { LogBadge } from "../../operation-log/log-badge";
import { formatClock } from "../../operation-log/log-display";

type LogRowProps = { entry: LogRecord };

export const LogRow = ({ entry }: LogRowProps) => (
  <div className="flex items-start gap-2 border-b border-border/40 px-3 py-1.5">
    <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
      {formatClock(entry.timestamp)}
    </span>
    <LogBadge record={entry} />
    <span className="min-w-0 flex-1 text-body-sm text-foreground">{entry.message}</span>
  </div>
);
