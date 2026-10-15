import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo } from "react";
import { PAGE_SIZE_OPTIONS, parsePageSize, type PageSize } from "./log-filters";

const PAGE_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-0.5 rounded-sm border border-border px-2 text-body-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

type LogPagerProps = {
  /** 从 0 开始 */
  pageIndex: number;
  pageCount: number;
  pageSize: PageSize;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
};

/** 日志列表分页：最新的在第一页 */
export const LogPager = memo(
  ({ pageIndex, pageCount, pageSize, onPageChange, onPageSizeChange }: LogPagerProps) => (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-3 text-body-sm">
      <span className="text-muted-foreground">每页</span>
      <select
        aria-label="每页条数"
        value={pageSize}
        onChange={(event) => onPageSizeChange(parsePageSize(event.target.value))}
        className="h-7 rounded-sm border border-border bg-input-background px-2 text-body-sm text-foreground"
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">条</span>
      <span className="ml-auto font-mono text-mono-sm tabular-nums text-muted-foreground">
        第 {pageIndex + 1} / {pageCount} 页
      </span>
      <button
        type="button"
        aria-label="上一页"
        disabled={pageIndex <= 0}
        onClick={() => onPageChange(pageIndex - 1)}
        className={PAGE_BUTTON_CLASS}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        上一页
      </button>
      <button
        type="button"
        aria-label="下一页"
        disabled={pageIndex >= pageCount - 1}
        onClick={() => onPageChange(pageIndex + 1)}
        className={PAGE_BUTTON_CLASS}
      >
        下一页
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  ),
);
