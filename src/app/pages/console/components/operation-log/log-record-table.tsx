import { memo, useEffect, useMemo, useRef } from "react";
import { LOG_RESULT, type LogRecord } from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import { LogBadge } from "./log-badge";
import { formatClockMs, formatDate, LOG_LEVEL_LABEL, resultText } from "./log-display";

const ResultCell = ({ record }: { record: LogRecord }) => {
  const text = resultText(record);
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={record.result === LOG_RESULT.ok ? "text-show" : "text-destructive"}>{text}</span>
  );
};

type LogRecordTableProps = {
  /** 时间升序；表格按最新在上显示 */
  records: LogRecord[];
  selectedId: string | null;
  onSelect: (record: LogRecord) => void;
  className?: string;
};

/** memo：拖动时间线时列表的输入不变，不用重画（每页最多 500 行） */
export const LogRecordTable = memo(({
  records,
  selectedId,
  onSelect,
  className,
}: LogRecordTableProps) => {
  const rows = useMemo(() => [...records].reverse(), [records]);
  const multiDay = useMemo(
    () => records.length > 0 && formatDate(records[0].timestamp) !== formatDate(records[records.length - 1].timestamp),
    [records],
  );
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 翻页 / 重新查询后回到列表顶部（最新的一条）
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [records]);

  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <div ref={scrollerRef} className={cn("custom-scrollbar overflow-auto bg-background", className)}>
      <table className="w-full min-w-[560px] table-fixed text-body-sm">
        <colgroup>
          <col className={multiDay ? "w-[150px]" : "w-[104px]"} />
          <col className="w-[84px]" />
          <col className="w-[48px]" />
          <col className="w-[84px]" />
          <col />
          <col className="w-[48px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="text-left text-label-caps text-muted-foreground">
            <th className="px-2 py-1.5 font-normal">时间</th>
            <th className="px-2 py-1.5 font-normal">类别</th>
            <th className="px-2 py-1.5 font-normal">级别</th>
            <th className="px-2 py-1.5 font-normal">用户</th>
            <th className="px-2 py-1.5 font-normal">内容</th>
            <th className="px-2 py-1.5 font-normal">结果</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((record) => {
            const selected = record.id === selectedId;
            return (
              <tr
                key={record.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(record.id, el);
                  else rowRefs.current.delete(record.id);
                }}
                aria-selected={selected}
                onClick={() => onSelect(record)}
                className={cn(
                  "cursor-pointer border-b border-border/40 transition-colors",
                  selected ? "bg-primary/15" : "hover:bg-accent",
                  record.level === "debug" && !selected && "text-muted-foreground",
                )}
              >
                <td className="truncate px-2 py-1 font-mono text-mono-sm tabular-nums text-muted-foreground">
                  {multiDay ? `${formatDate(record.timestamp)} ` : ""}
                  {formatClockMs(record.timestamp)}
                </td>
                <td className="px-2 py-1">
                  <LogBadge record={record} />
                </td>
                <td className="truncate px-2 py-1 text-muted-foreground">{LOG_LEVEL_LABEL[record.level]}</td>
                <td className="truncate px-2 py-1">{record.user ?? "—"}</td>
                <td className="truncate px-2 py-1 text-foreground" title={record.message}>
                  {record.message}
                </td>
                <td className="px-2 py-1">
                  <ResultCell record={record} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
