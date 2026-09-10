import { Search } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { AXIS_STATUS } from "./monitor-status";
import type { ControlledObjectStatus } from "./monitor-data";

type EntityTab = "object" | "motor";
type ObjectLayout = "card" | "table";

type MonitorGridToolbarProps = {
  entity: EntityTab;
  onEntityChange: (value: EntityTab) => void;
  objectLayout: ObjectLayout;
  onObjectLayoutChange: (value: ObjectLayout) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  showFilters?: boolean;
};

const OBJECT_STATUS_OPTIONS: { value: ControlledObjectStatus | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "running", label: "运行中" },
  { value: "ready", label: "就绪" },
  { value: "warning", label: "警告" },
  { value: "alarm", label: "报警" },
  { value: "disabled", label: "未使能" },
  { value: "offline", label: "离线" },
];

const MOTOR_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "全部状态" },
  ...Object.entries(AXIS_STATUS).map(([code, entry]) => ({
    value: code,
    label: entry.label,
  })),
];

const SEGMENT_BUTTON_CLASS =
  "h-7 px-2 text-body-sm border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const SegmentedControl = <T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) => (
  <div
    className="flex h-7 items-center rounded-sm bg-input-background"
    role="group"
    aria-label={ariaLabel}
  >
    {options.map((option) => {
      const active = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(option.value)}
          className={cn(
            SEGMENT_BUTTON_CLASS,
            active ? "border-primary text-primary" : "border-transparent text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

export const MonitorGridToolbar = ({
  entity,
  onEntityChange,
  objectLayout,
  onObjectLayoutChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  showFilters = true,
}: MonitorGridToolbarProps) => {
  const statusOptions = entity === "object" ? OBJECT_STATUS_OPTIONS : MOTOR_STATUS_OPTIONS;
  const searchPlaceholder = entity === "object" ? "搜索受控物体..." : "搜索电机...";

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      <SegmentedControl
        value={entity}
        options={[
          { value: "object", label: "物体" },
          { value: "motor", label: "电机" },
        ]}
        onChange={onEntityChange}
        ariaLabel="监控实体"
      />
      {entity === "object" && (
        <SegmentedControl
          value={objectLayout}
          options={[
            { value: "card", label: "卡片" },
            { value: "table", label: "表格" },
          ]}
          onChange={onObjectLayoutChange}
          ariaLabel="物体布局"
        />
      )}
      {showFilters ? (
        <>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            className="h-7 rounded-sm border border-border bg-input-background px-2 text-body-sm text-foreground"
            aria-label="状态筛选"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-sm border border-border bg-input-background px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-full min-w-0 flex-1 bg-transparent text-body-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
    </div>
  );
};

export type { EntityTab, MonitorGridToolbarProps, ObjectLayout };
