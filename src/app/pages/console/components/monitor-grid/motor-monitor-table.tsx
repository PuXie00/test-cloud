import { useEffect, useMemo, useState } from "react";
import type { DisplayAttribute } from "@shared/config";
import { cn } from "@/app/components/ui/utils";
import { MotorStatusBadge } from "../build-debug/motor-status-badge";
import { motorRuntimeStatusFromLive } from "./monitor-status";
import {
  getExtendedStateAttrs,
  preloadMotorModelConfigs,
} from "../../hooks/motor-config";
import { FIXED_AXIS_FIELD_IDS, type MotorMonitorSnapshot } from "./monitor-data";
import { formatExtendedValue, formatMonitorNullableNumber } from "./monitor-format";

const FIXED_HEADERS = ["ID", "状态", "位置", "速度", "负载率", "温度", "扭矩"];

type Column = { key: string; label: string };

type MotorMonitorTableProps = {
  motors: MotorMonitorSnapshot[];
};

export const MotorMonitorTable = ({ motors }: MotorMonitorTableProps) => {
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

  const extendedAttrs = useMemo<DisplayAttribute[]>(() => {
    if (!catalogReady) return [];
    return getExtendedStateAttrs(motors.map((motor) => motor.productModel)).filter(
      (attr) => !FIXED_AXIS_FIELD_IDS.has(attr.id),
    );
  }, [catalogReady, motors]);

  const columns = useMemo<Column[]>(
    () => [
      ...FIXED_HEADERS.map((label) => ({ key: label, label })),
      ...extendedAttrs.map((attr) => ({ key: attr.id, label: attr.label })),
      { key: "driveAlarmCode", label: "报警码" },
    ],
    [extendedAttrs],
  );

  return (
    <table className="w-full min-w-[720px] border-collapse text-body-sm">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className="px-3 py-2 text-left text-label-caps text-muted-foreground"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {motors.map((motor, index) => (
          <tr
            key={motor.id}
            className={index % 2 === 0 ? "bg-input-background" : "bg-accent/40"}
          >
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-foreground">
              {motor.id}
            </td>
            <td className="px-3 py-2">
              <MotorStatusBadge
                kind={{
                  type: "runtime",
                  status: motorRuntimeStatusFromLive(motor),
                }}
              />
            </td>
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {formatMonitorNullableNumber(motor.actualPosition)}
            </td>
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {formatMonitorNullableNumber(motor.actualSpeed)}
            </td>
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {formatMonitorNullableNumber(motor.actualLoadRate)}
            </td>
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {formatMonitorNullableNumber(motor.actualTemperature)}
            </td>
            <td className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground">
              {formatMonitorNullableNumber(motor.actualTorque)}
            </td>
            {extendedAttrs.map((attr) => (
              <td
                key={attr.id}
                className="px-3 py-2 font-mono text-mono-sm tabular-nums text-muted-foreground"
              >
                {formatExtendedValue(attr, motor.extras[attr.id])}
              </td>
            ))}
            <td
              className={cn(
                "px-3 py-2 font-mono text-mono-sm tabular-nums",
                motor.driveAlarmCode !== null && motor.driveAlarmCode !== 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {formatMonitorNullableNumber(motor.driveAlarmCode)}
            </td>
            
          </tr>
        ))}
      </tbody>
    </table>
  );
};
