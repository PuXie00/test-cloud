import { useEffect, useRef } from "react";
import type { LogRecord } from "@shared/csocket/operation-log";
import { useLogStream } from "../../../hooks/use-log-stream";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import { LogRow } from "./log-row";
import { LogToolbar } from "./log-toolbar";

/** 演出模式只看报警和警告 / 错误 */
const isShowModeVisible = (entry: LogRecord) =>
  entry.category === "alarm" || entry.level !== "info";

export const LogTab = () => {
  const { logs, liveTail, setLiveTail } = useLogStream();
  const { mode } = useConsoleMode();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const filtered = mode === "show" ? logs.filter(isShowModeVisible) : logs;
  const newestId = filtered.at(-1)?.id;

  useEffect(() => {
    if (liveTail && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [newestId, liveTail]);

  return (
    <div className="flex h-full flex-col">
      <LogToolbar liveTail={liveTail} onToggleLiveTail={() => setLiveTail(!liveTail)} />
      <div ref={scrollerRef} className="custom-scrollbar flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-body-sm text-muted-foreground">暂无日志</p>
        ) : (
          filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
};
