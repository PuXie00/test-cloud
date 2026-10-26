import { RotateCcw } from "lucide-react";
import { memo, type ReactNode } from "react";
import {
  type LogFilterOptions,
  type VisibleLogCategory,
} from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import {
  ALL_CATEGORIES,
  CATEGORY_LABEL,
  LOG_LEVEL_LABEL,
} from "./log-display";
import {
  DEFAULT_LOG_FILTERS,
  isDefaultFilters,
  TIME_PRESET_OPTIONS,
  type LogFilters,
  type TimePreset,
} from "./log-filters";

const SELECT_CLASS =
  "h-7 min-w-0 rounded-sm border border-border bg-input-background px-2 text-body-sm text-foreground";

type FilterSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: { value: string; label: string }[];
  /** 空值选项的文字，缺省「<label>：全部」 */
  allLabel?: string;
  children?: ReactNode;
};

const FilterSelect = ({ label, value, onChange, options = [], allLabel, children }: FilterSelectProps) => (
  <select
    aria-label={label}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={cn(SELECT_CLASS, value && "border-primary/60 text-primary")}
  >
    <option value="">{allLabel ?? `${label}：全部`}</option>
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
    {children}
  </select>
);

type LogFilterBarProps = {
  filters: LogFilters;
  onChange: (filters: LogFilters) => void;
  options: LogFilterOptions | null;
};

export const LogFilterBar = memo(({ filters, onChange, options }: LogFilterBarProps) => {
  const patch = (next: Partial<LogFilters>) => onChange({ ...filters, ...next });

  const toggleCategory = (category: VisibleLogCategory) => {
    const has = filters.categories.includes(category);
    if (has && filters.categories.length === 1) return;
    patch({
      categories: has
        ? filters.categories.filter((c) => c !== category)
        : ALL_CATEGORIES.filter((c) => c === category || filters.categories.includes(c)),
    });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
      <select
        aria-label="时间范围"
        value={filters.timePreset}
        onChange={(event) => patch({ timePreset: event.target.value as TimePreset })}
        className={SELECT_CLASS}
      >
        {TIME_PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {filters.timePreset === "custom" && (
        <>
          <input
            type="datetime-local"
            step={1}
            aria-label="开始时间"
            value={filters.customStart}
            onChange={(event) => patch({ customStart: event.target.value })}
            className={SELECT_CLASS}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="datetime-local"
            step={1}
            aria-label="结束时间"
            value={filters.customEnd}
            onChange={(event) => patch({ customEnd: event.target.value })}
            className={SELECT_CLASS}
          />
        </>
      )}

      <div className="flex items-center gap-1" role="group" aria-label="记录类别">
        {ALL_CATEGORIES.map((category) => {
          const active = filters.categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={active}
              onClick={() => toggleCategory(category)}
              className={cn(
                "h-7 rounded-sm border px-2 text-body-sm transition-colors",
                active
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {CATEGORY_LABEL[category]}
            </button>
          );
        })}
      </div>

      <FilterSelect
        label="用户"
        value={filters.user}
        onChange={(user) => patch({ user })}
        options={(options?.users ?? []).map((user) => ({ value: user, label: user }))}
      />
      <FilterSelect
        label="日志级别"
        allLabel="日志级别：全部（不含调试）"
        value={filters.logLevel}
        onChange={(logLevel) => patch({ logLevel: logLevel as LogFilters["logLevel"] })}
        options={[
          ...(["info", "warning", "error", "debug"] as const).map((level) => ({
            value: level,
            label: LOG_LEVEL_LABEL[level],
          })),
          { value: "all", label: "全部（含调试）" },
        ]}
      />

      <button
        type="button"
        onClick={() => onChange(DEFAULT_LOG_FILTERS)}
        disabled={isDefaultFilters(filters)}
        className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-body-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        重置
      </button>
    </div>
  );
});
