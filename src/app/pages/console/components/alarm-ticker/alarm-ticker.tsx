import { Bell } from "lucide-react";
import { useMemo } from "react";
import { useLogStream } from "../../hooks/use-log-stream";

export const AlarmTicker = () => {
  const { logs } = useLogStream();
  const alarmText = useMemo(
    () =>
      logs
        .filter((entry) => entry.level === "alarm" || entry.level === "fault")
        .slice(-5)
        .map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.message}`)
        .join("    ·    "),
    [logs]
  );

  if (!alarmText) return null;

  return (
    <div className="flex h-6 max-w-[420px] items-center gap-2 overflow-hidden rounded-sm bg-destructive/10 px-2 text-destructive">
      <Bell className="h-3 w-3" aria-hidden />
      <span className="truncate text-body-sm">{alarmText}</span>
    </div>
  );
};
