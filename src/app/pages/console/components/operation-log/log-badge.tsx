import type { LogRecord } from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import { logBadge } from "./log-display";

export const LogBadge = ({ record, className }: { record: LogRecord; className?: string }) => {
  const badge = logBadge(record);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 text-label-caps leading-4",
        badge.className,
        className,
      )}
    >
      {badge.label}
    </span>
  );
};
