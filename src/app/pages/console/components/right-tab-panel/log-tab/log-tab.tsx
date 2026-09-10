import { useEffect, useRef } from "react";
import { useLogStream } from "../../../hooks/use-log-stream";
import { useConsoleMode } from "../../../hooks/use-console-mode";
import { LogRow } from "./log-row";
import { LogToolbar } from "./log-toolbar";

export const LogTab = () => {
  const { logs, liveTail, setLiveTail, acceptedLevels } = useLogStream();
  const { mode } = useConsoleMode();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const effectiveLevels = mode === "show"
    ? new Set(["warning", "alarm", "fault"] as const)
    : acceptedLevels;

  const filtered = logs.filter((entry) => effectiveLevels.has(entry.level));

  useEffect(() => {
    if (liveTail && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [filtered.length, liveTail]);

  return (
    <div className="flex h-full flex-col">
      <LogToolbar liveTail={liveTail} onToggleLiveTail={() => setLiveTail(!liveTail)} />
      <div ref={scrollerRef} className="custom-scrollbar flex-1 overflow-y-auto">
        {filtered.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
};
