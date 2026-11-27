import { useEffect, useMemo, useState } from "react";
import type { DisplayAttribute } from "@shared/config";
import { cn } from "@/app/components/ui/utils";
import { MotorStatusBadge } from "../build-debug/motor-status-badge";
import { motorRuntimeStatusFromLive, type MotorRuntimeStatus } from "./monitor-status";
import {
  getExtendedStateAttrs,
  preloadMotorModelConfigs,
} from "../../hooks/motor-config";
import { FIXED_AXIS_FIELD_IDS, type MotorMonitorSnapshot } from "./monitor-data";
import { formatExtendedValue, formatMonitorNullableNumber } from "./monitor-format";
import { SortableMonitorHeader, sortMonitorRows, type MonitorSort } from "./monitor-table-sort";

type MotorColumn = {
  key: string;
  label: string;
  value: (motor: MotorMonitorSnapshot) => number | string | null | undefined;
};

const statusPriority: Record<MotorRuntimeStatus, number> = { error: 0, moving: 1, idle: 2, powerOff: 3 };

const numericColumn = (
  key: "id" | "actualPosition" | "actualSpeed" | "actualLoadRate" | "actualTemperature" | "actualTorque" | "driveAlarmCode",
  label: string,
): MotorColumn => ({ key, label, value: motor => motor[key] });

const fixedColumns: MotorColumn[] = [
  numericColumn("id", "ID"),
  { key: "status", label: "状态", value: motor => statusPriority[motorRuntimeStatusFromLive(motor)] },
  numericColumn("actualPosition", "位置"),
  numericColumn("actualSpeed", "速度"),
  numericColumn("actualLoadRate", "负载率"),
  numericColumn("actualTemperature", "温度"),
  numericColumn("actualTorque", "扭矩"),
];
const alarmColumn = numericColumn("driveAlarmCode", "报警码");

const extendedColumn = (attr: DisplayAttribute): MotorColumn => ({
  key: `extra:${attr.id}`,
  label: attr.label,
  value: motor => {
    const raw = attr.id === "actualWeight" ? motor.actualWeight ?? motor.extras[attr.id] : motor.extras[attr.id];
    return raw != null && attr.dataType === "enum" ? formatExtendedValue(attr, raw) : raw;
  },
});

type MotorMonitorTableProps = {
  motors: MotorMonitorSnapshot[];
  sort: MonitorSort;
  onSort: (key: string) => void;
};

export const MotorMonitorTable = ({ motors, sort, onSort }: MotorMonitorTableProps) => {
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void preloadMotorModelConfigs().then(() => {
      if (!cancelled) setCatalogReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = useMemo(() => {
    const models = new Set(motors.map(motor => motor.productModel));
    const attrs = catalogReady ? getExtendedStateAttrs([...models]) : [];
    const extraColumns = attrs.filter(attr => !FIXED_AXIS_FIELD_IDS.has(attr.id)).map(extendedColumn);
    return [...fixedColumns, ...extraColumns, alarmColumn];
  }, [catalogReady, motors]);

  const rows = useMemo(() => {
    const column = columns.find(item => item.key === sort?.key);
    return column ? sortMonitorRows(motors, sort, column.value) : motors;
  }, [columns, motors, sort]);

  return (
    <table className="w-full min-w-[720px] border-collapse text-body-sm">
      <thead>
        <tr>
          {columns.map(column => (
            <SortableMonitorHeader
              key={column.key}
              columnKey={column.key}
              label={column.label}
              sort={sort}
              onSort={onSort}
              hint={column.key === "status" ? "升序优先显示错误" : undefined}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((motor, index) => (
          <tr
            key={motor.id}
            className={index % 2 === 0 ? "bg-input-background" : "bg-accent/40"}
          >
            {columns.map(column => {
              if (column.key === "status") {
                return (
                  <td key={column.key} className="px-3 py-2">
                    <MotorStatusBadge kind={{ type: "runtime", status: motorRuntimeStatusFromLive(motor) }} />
                  </td>
                );
              }
              const value = column.value(motor);
              return (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground",
                    column.key === "id" && "text-foreground",
                    column.key === "driveAlarmCode" && !!value && "text-destructive",
                  )}
                >
                  {typeof value === "string" ? value : formatMonitorNullableNumber(value ?? null)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
