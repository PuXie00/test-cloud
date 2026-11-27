import type { KeyboardEvent, MouseEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { ControlledObjectSnapshot, ControlledObjectStatus } from "./monitor-data";
import { formatMonitorDimension } from "./monitor-display";
import { SortableMonitorHeader, sortMonitorRows, type MonitorSort } from "./monitor-table-sort";
import { ObjectStatusBadge, resolveObjectStatusLabel } from "./object-status-badge";

const STATUS_ORDER: Record<ControlledObjectStatus, number> = {
  alarm: 0, warning: 1, running: 2, ready: 3, disabled: 4, offline: 5,
};
const COLUMNS = [
  ["name", "名称"], ["status", "状态"], ["h", "H"], ["p", "P"], ["y", "Y"],
] as const;
const SORT_HINTS: Partial<Record<typeof COLUMNS[number][0], string>> = {
  status: "升序优先显示报警和警告",
  h: "长度和角度分组排序",
};

const hUnit = (snapshot: ControlledObjectSnapshot) => snapshot.descriptor.dimensions[0]?.unit ?? "mm";

const valueForSort = (row: ControlledObjectSnapshot, key: string) => {
  if (key === "name") return row.descriptor.name;
  if (key === "status") {
    const status = row.descriptor.status;
    return `${STATUS_ORDER[status]} ${resolveObjectStatusLabel(status, row.modelStatus)}`;
  }
  if (key === "h" || key === "p" || key === "y") return row.positions?.[key];
};

export const sortMonitorObjects = (rows: ControlledObjectSnapshot[], sort: MonitorSort) =>
  sortMonitorRows(rows, sort, valueForSort, sort?.key === "h" ? hUnit : undefined);

const formatAxisCell = (
  value: number | null | undefined,
  unit: string,
  displayUnit: ReturnType<typeof useSessionDisplayLengthUnit>,
): string => {
  if (value === null || value === undefined) return "—";
  return formatMonitorDimension(value, unit, displayUnit);
};

type ObjectMonitorTableProps = {
  snapshots: ControlledObjectSnapshot[];
  selectedIds: number[];
  onSelect: (id: number, event: MouseEvent | KeyboardEvent) => void;
  sort: MonitorSort;
  onSort: (key: string) => void;
};

export const ObjectMonitorTable = ({
  snapshots,
  selectedIds,
  onSelect,
  sort,
  onSort,
}: ObjectMonitorTableProps) => {
  const displayUnit = useSessionDisplayLengthUnit();

  return (
    <table className="w-full min-w-[480px] border-collapse text-body-sm">
      <thead>
        <tr>
          {COLUMNS.map(([key, label]) => (
            <SortableMonitorHeader key={key} columnKey={key} label={label} sort={sort} onSort={onSort}
              hint={SORT_HINTS[key]} />
          ))}
        </tr>
      </thead>
      <tbody>
        {snapshots.map((snapshot, index) => {
          const { descriptor, positions } = snapshot;
          const isSelected = selectedIds.includes(descriptor.id);
          return (
            <tr
              key={descriptor.id}
              role="row"
              tabIndex={0}
              onClick={(event) => onSelect(descriptor.id, event)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(descriptor.id, event);
                }
              }}
              className={cn(
                "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index % 2 === 0 ? "bg-input-background" : "bg-accent/40",
                isSelected && "border-l-2 border-primary bg-accent",
              )}
            >
              <td className="px-3 py-2 font-medium text-foreground">{descriptor.name}</td>
              <td className="px-3 py-2">
                <ObjectStatusBadge
                  status={descriptor.status}
                  modelStatus={snapshot.modelStatus}
                />
              </td>
              <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatAxisCell(positions?.h, hUnit(snapshot), displayUnit)}
              </td>
              <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatAxisCell(positions?.p, "°", displayUnit)}
              </td>
              <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatAxisCell(positions?.y, "°", displayUnit)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
