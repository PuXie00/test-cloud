import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogRecord } from "@shared/csocket/operation-log";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import { alarmReviewWindow } from "./alarm-review";
import { isRaisedAlarm } from "./log-display";
import { LogDetailPanel } from "./log-detail-panel";
import { LogFilterBar } from "./log-filter-bar";
import {
  DEFAULT_LOG_FILTERS,
  includesDebug,
  opTypeKey,
  pageCount,
  readStoredPageSize,
  writeStoredPageSize,
  type LogFilters,
  type PageSize,
} from "./log-filters";
import { LogPager } from "./log-pager";
import { LogRecordTable } from "./log-record-table";
import { LogTimeline } from "./log-timeline";
import {
  ensureVisible,
  fitView,
  recordsExtent,
  viewAround,
  type TimeRange,
} from "./timeline-scale";
import { useAlarmReview, useLogFilterOptions, useLogQuery } from "./use-operation-log";

/** 最多缩小到数据跨度的几倍 */
const MAX_SPAN_FACTOR = 3;
const MIN_MAX_SPAN_MS = 10 * 60_000;

const OperationLogBody = () => {
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS);
  // 相对时间（最近 15 分钟等）的基准：改筛选、刷新时更新，翻页不变
  const [queryNow, setQueryNow] = useState(() => Date.now());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(readStoredPageSize);
  const options = useLogFilterOptions();
  const query = useLogQuery(filters, { index: pageIndex, size: pageSize }, queryNow);
  const { records } = query;
  const totalPages = pageCount(query.total, pageSize);

  // 刷新后总数变少时，停在最后一页
  useEffect(() => {
    if (query.status === "ready" && pageIndex > totalPages - 1) setPageIndex(totalPages - 1);
  }, [query.status, pageIndex, totalPages]);

  const handleFiltersChange = useCallback((next: LogFilters) => {
    setFilters(next);
    setPageIndex(0);
    setQueryNow(Date.now());
  }, []);

  const handlePageSizeChange = useCallback((size: PageSize) => {
    setPageSize(size);
    writeStoredPageSize(size);
    setPageIndex(0);
  }, []);

  const opTypeLabels = useMemo(
    () => new Map((options?.opTypes ?? []).map((op) => [opTypeKey(op.group, op.code), op.label])),
    [options],
  );

  const bounds = useMemo(() => recordsExtent(records), [records]);
  const [view, setView] = useState<TimeRange>(() => fitView(null));
  useEffect(() => {
    setView(fitView(bounds));
  }, [bounds]);
  const maxSpan = bounds
    ? Math.max((bounds.end - bounds.start) * MAX_SPAN_FACTOR, MIN_MAX_SPAN_MS)
    : Infinity;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );
  const reviewAlarm = selected && isRaisedAlarm(selected) ? selected : null;
  const review = useAlarmReview(reviewAlarm?.id ?? null);
  const highlight = reviewAlarm ? alarmReviewWindow(reviewAlarm) : null;

  const handleSelect = useCallback((record: LogRecord) => {
    setSelectedId(record.id);
    setCursor(record.timestamp);
    setView((current) =>
      isRaisedAlarm(record)
        ? viewAround(alarmReviewWindow(record))
        : ensureVisible(current, record.timestamp),
    );
  }, []);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 bg-muted px-4">
        <DialogTitle className="text-heading-lg font-semibold text-foreground">操作日志与回放</DialogTitle>
        <span className="text-body-sm text-muted-foreground">
          {query.status === "ready" ? `共 ${query.total} 条` : null}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="刷新"
            onClick={() => setQueryNow(Date.now())}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {query.status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
          <DialogPrimitive.Close
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </div>
      </div>
      <DialogDescription className="sr-only">
        当前工程的操作、报警和状态快照统一时间线，支持多维筛选、报警前后回看和趋势分析
      </DialogDescription>

      <LogFilterBar filters={filters} onChange={handleFiltersChange} options={options} />

      <LogTimeline
        records={records}
        view={view}
        onViewChange={setView}
        onFit={() => setView(fitView(bounds))}
        maxSpan={maxSpan}
        cursor={cursor}
        onCursorChange={setCursor}
        selectedId={selectedId}
        onSelect={handleSelect}
        highlight={highlight}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {query.status === "error" ? (
            <p className="p-4 text-body-sm text-destructive">{query.error}</p>
          ) : query.status === "ready" && records.length === 0 ? (
            <p className="p-4 text-body-sm text-muted-foreground">没有符合条件的记录</p>
          ) : (
            <LogRecordTable
              records={records}
              selectedId={selectedId}
              onSelect={handleSelect}
              opTypeLabels={opTypeLabels}
              className={cn("min-h-0 flex-1", query.status === "loading" && "opacity-60")}
            />
          )}
          {query.status !== "error" && (
            <LogPager
              pageIndex={pageIndex}
              pageCount={totalPages}
              pageSize={pageSize}
              onPageChange={setPageIndex}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </div>
        <LogDetailPanel
          selected={selected}
          review={review}
          showDebug={includesDebug(filters)}
          cursor={cursor}
          onCursorChange={setCursor}
          opTypeLabels={opTypeLabels}
          className="w-[440px] shrink-0 border-l border-border"
        />
      </div>
    </>
  );
};

export type OperationLogDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const OperationLogDialog = ({ open, onOpenChange }: OperationLogDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "fixed top-[50%] left-[50%] z-50 flex h-[880px] max-h-[calc(100vh-2rem)] w-[1400px] max-w-[calc(100vw-2rem)]",
          "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg",
          "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
        )}
        aria-describedby={undefined}
      >
        <OperationLogBody />
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>
);
