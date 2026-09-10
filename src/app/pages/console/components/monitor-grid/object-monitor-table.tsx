import type { KeyboardEvent, MouseEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { ControlledObjectSnapshot } from "./monitor-data";
import { formatMonitorDimension } from "./monitor-display";
import { ObjectStatusBadge } from "./object-status-badge";

const formatAxisCell = (
  value: number | null | undefined,
  unit: "mm" | "°",
  displayUnit: ReturnType<typeof useSessionDisplayLengthUnit>,
): string => {
  if (value === null || value === undefined) return "—";
  return formatMonitorDimension(value, unit, displayUnit);
};

type ObjectMonitorTableProps = {
  snapshots: ControlledObjectSnapshot[];
  selectedIds: number[];
  onSelect: (id: number, event: MouseEvent | KeyboardEvent) => void;
};

export const ObjectMonitorTable = ({
  snapshots,
  selectedIds,
  onSelect,
}: ObjectMonitorTableProps) => {
  const displayUnit = useSessionDisplayLengthUnit();

  return (
    <table className="w-full min-w-[480px] border-collapse text-body-sm">
      <thead>
        <tr>
          {["名称", "状态", "H", "P", "Y"].map((label) => (
            <th
              key={label}
              scope="col"
              className="px-3 py-2 text-left text-label-caps text-muted-foreground"
            >
              {label}
            </th>
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
                {formatAxisCell(positions?.h, "mm", displayUnit)}
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
