import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useProjectDocument } from "@/app/project/use-project-document";
import { cn } from "@/app/components/ui/utils";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { useProjectStore } from "../../hooks/use-project-store";
import { idsInRange, resolveSelectionMode } from "../../hooks/selection-range";
import { useSelection } from "../../hooks/use-selection";
import { MonitorEmptyGuide } from "./monitor-empty-guide";
import { MonitorGridToolbar } from "./monitor-grid-toolbar";
import { MotorMonitorTable } from "./motor-monitor-table";
import { ObjectMonitorCard } from "./object-monitor-card";
import { ObjectMonitorTable } from "./object-monitor-table";
import type { ControlledObjectStatus } from "./monitor-data";
import { isMonitorEmpty, isMonitorMotorsEmpty } from "./monitor-utils";

type MonitorGridProps = { className?: string };

export const MonitorGrid = ({ className }: MonitorGridProps) => {
  const { snapshots, motorSnapshots } = useControlledObjects();
  const { objects, motors } = useProjectStore();
  const document = useProjectDocument();
  const { multiSelectedIds, select, toggleMulti, replaceSelection } = useSelection();
  const [entity, setEntity] = useState<"object" | "motor">("object");
  const [objectLayout, setObjectLayout] = useState<"card" | "table">("card");
  const [search, setSearch] = useState("");
  const [objectStatusFilter, setObjectStatusFilter] = useState<ControlledObjectStatus | "all">("all");
  const [motorStatusFilter, setMotorStatusFilter] = useState<string>("all");

  const monitorEmpty = isMonitorEmpty(document, objects.length);
  const motorsEmpty = isMonitorMotorsEmpty(motors.length);
  const isCurrentEmpty = entity === "object" ? monitorEmpty : motorsEmpty;

  const filteredObjects = useMemo(
    () =>
      snapshots.filter((snapshot) => {
        if (objectStatusFilter !== "all" && snapshot.descriptor.status !== objectStatusFilter) {
          return false;
        }
        if (search && !snapshot.descriptor.name.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        return true;
      }),
    [snapshots, search, objectStatusFilter],
  );

  const filteredMotors = useMemo(
    () =>
      motorSnapshots.filter((motor) => {
        if (search && !motor.displayName.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (motorStatusFilter === "all") return true;
        return String(motor.axisStatus) === motorStatusFilter;
      }),
    [motorSnapshots, search, motorStatusFilter],
  );

  const orderedIds = useMemo(
    () => filteredObjects.map((snapshot) => snapshot.descriptor.id),
    [filteredObjects],
  );

  const handleObjectSelect = (id: number, event: MouseEvent | KeyboardEvent) => {
    const mode = resolveSelectionMode(event);
    if (mode === "toggle") {
      toggleMulti(id);
      return;
    }
    if (mode === "range") {
      const anchor = multiSelectedIds[multiSelectedIds.length - 1];
      replaceSelection(idsInRange(orderedIds, anchor, id));
      return;
    }
    select(id);
  };

  const showCardLayout = entity === "object" && objectLayout === "card";
  const filteredCount = entity === "object" ? filteredObjects.length : filteredMotors.length;

  return (
    <section className={cn("flex min-h-0 flex-col rounded-lg bg-card", className)}>
      <MonitorGridToolbar
        entity={entity}
        onEntityChange={setEntity}
        objectLayout={objectLayout}
        onObjectLayoutChange={setObjectLayout}
        search={search}
        onSearchChange={setSearch}
        statusFilter={entity === "object" ? objectStatusFilter : motorStatusFilter}
        onStatusFilterChange={(value) => {
          if (entity === "object") {
            setObjectStatusFilter(value as ControlledObjectStatus | "all");
          } else {
            setMotorStatusFilter(value);
          }
        }}
        showFilters={!isCurrentEmpty}
      />
      <div
        className={cn(
          "custom-scrollbar min-h-0 flex-1 p-3",
          isCurrentEmpty || filteredCount === 0
            ? "flex items-center justify-center"
            : showCardLayout
              ? "overflow-x-auto overflow-y-hidden"
              : "overflow-auto",
        )}
      >
        {isCurrentEmpty ? (
          <MonitorEmptyGuide kind={entity} />
        ) : filteredCount === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            {entity === "object" ? "无符合条件的受控物体" : "无符合条件的电机"}
          </p>
        ) : entity === "motor" ? (
          <MotorMonitorTable motors={filteredMotors} />
        ) : objectLayout === "table" ? (
          <ObjectMonitorTable
            snapshots={filteredObjects}
            selectedIds={multiSelectedIds}
            onSelect={handleObjectSelect}
          />
        ) : (
          <div className="flex w-max min-h-full flex-nowrap items-start gap-3">
            {filteredObjects.map((snapshot) => (
              <ObjectMonitorCard
                key={snapshot.descriptor.id}
                snapshot={snapshot}
                isSelected={multiSelectedIds.includes(snapshot.descriptor.id)}
                onSelect={(event) => handleObjectSelect(snapshot.descriptor.id, event)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
