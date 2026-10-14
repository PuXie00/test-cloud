import { useEffect, useState } from "react";
import { useLogStream } from "../../hooks/use-log-stream";
import { LogBadge } from "../operation-log/log-badge";
import { formatClock, isFailedOperation, resultText } from "../operation-log/log-display";

const tickClock = () => new Date().toTimeString().slice(0, 8);

const LatestLog = () => {
  const { latest } = useLogStream();
  if (!latest) return null;
  const text = isFailedOperation(latest) ? `${latest.message} · ${resultText(latest)}` : latest.message;
  return (
    <div
      className="flex min-w-0 max-w-[560px] items-center gap-2"
      title={`${formatClock(latest.timestamp)} ${text}`}
      aria-label="最新日志"
    >
      <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
        {formatClock(latest.timestamp)}
      </span>
      <LogBadge record={latest} />
      <span className="min-w-0 truncate text-body-sm text-foreground">{text}</span>
    </div>
  );
};

export const ConsoleFooter = () => {
  const [clock, setClock] = useState(tickClock);

  useEffect(() => {
    const id = setInterval(() => setClock(tickClock()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="flex h-6 shrink-0 select-none items-center justify-between gap-4 bg-background px-3">
      <div className="flex shrink-0 items-center gap-4">
        {/* <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-show" />
          <span className="text-label-caps text-muted-foreground">System Online</span>
        </div> */}
        {/* <span className="font-mono text-mono-sm text-muted-foreground">TC: --:--:--:--</span> */}
        <span className="font-mono text-mono-sm text-warning">规则引擎: 3 激活</span>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        {/* <span className="font-mono text-mono-sm text-muted-foreground">CPU: 12%</span> */}
        {/* <span className="font-mono text-mono-sm text-muted-foreground">MEM: 4.2GB</span> */}
        <LatestLog />
        <span className="shrink-0 font-mono text-mono-sm tabular-nums text-foreground">{clock}</span>
      </div>
    </footer>
  );
};
