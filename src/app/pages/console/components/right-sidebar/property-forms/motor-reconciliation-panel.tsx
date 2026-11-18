import { useState } from "react";
import { toast } from "sonner";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { Checkbox } from "@/app/components/ui/checkbox";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import {
  formatRealAxisModel,
  formatRealAxisPosition,
  toScannedAxes,
  type RealAxis,
} from "@/app/pages/console/hooks/plc-online";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { Motor } from "../config-wizard/config-wizard-types";

type MotorReconciliationPanelProps = {
  plcId: number;
  defaultOpen?: boolean;
};

const axisKey = (axis: Pick<RealAxis, "busNo" | "index">) => `${axis.busNo}:${axis.index}`;

const rowClass = "flex min-h-9 items-center gap-2 rounded-md bg-input-background px-3 py-1.5 text-body-sm";

/** 主控在线时，把工程里的电机和扫到的实轴逐根对一遍：加入多出的实轴、删掉没有实轴的电机 */
export const MotorReconciliationPanel = ({
  plcId,
  defaultOpen = false,
}: MotorReconciliationPanelProps) => {
  const { findPlc, getPlcMotors, addMotorsFromScannedAxes, removeMotors } = useProjectStore();
  const { getPlcOnline } = usePlcRuntime();
  const plc = findPlc(plcId);
  const online = getPlcOnline(plcId);
  const configuredMotors = getPlcMotors(plcId);

  const [adoptKeys, setAdoptKeys] = useState<Set<string>>(new Set());
  const [removeIds, setRemoveIds] = useState<Set<number>>(new Set());

  if (!plc || online.kind !== "online") return null;

  const byStatus = (status: "online" | "modelMismatch" | "offline"): Motor[] =>
    configuredMotors.filter((motor) => online.motorById.get(motor.id)?.status === status);
  const onlineMotors = byStatus("online");
  const mismatchMotors = byStatus("modelMismatch");
  const offlineMotors = byStatus("offline");
  const discovered = online.discovered;
  const adoptAxes = discovered.filter((axis) => adoptKeys.has(axisKey(axis)));

  // 电机按口内顺序对实轴：勾一根就把同口前面的也勾上，取消一根就把同口后面的也取消
  const toggleAdopt = (axis: RealAxis) => {
    setAdoptKeys((current) => {
      const next = new Set(current);
      const sameBus = discovered.filter((item) => item.busNo === axis.busNo);
      if (current.has(axisKey(axis))) {
        for (const item of sameBus) if (item.index >= axis.index) next.delete(axisKey(item));
      } else {
        for (const item of sameBus) if (item.index <= axis.index) next.add(axisKey(item));
      }
      return next;
    });
  };

  const toggleRemove = (motorId: number, checked: boolean) => {
    setRemoveIds((current) => {
      const next = new Set(current);
      if (checked) next.add(motorId);
      else next.delete(motorId);
      return next;
    });
  };

  const handleApply = () => {
    if (adoptAxes.length > 0) addMotorsFromScannedAxes(plcId, toScannedAxes(adoptAxes));
    if (removeIds.size > 0) removeMotors([...removeIds]);
    setAdoptKeys(new Set());
    setRemoveIds(new Set());
    toast.success("对账变更已应用");
  };

  const motorName = (motor: Motor) => formatMotorDisplayName(configuredMotors, motor);

  return (
    <CollapsePanel title="连接对账" defaultOpen={defaultOpen}>
      <div className="space-y-4">
        {onlineMotors.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">在线（{onlineMotors.length}）</p>
            <ul className="space-y-1">
              {onlineMotors.map((motor) => (
                <li key={motor.id} className={rowClass}>
                  <span className="font-mono text-show tabular-nums">{motorName(motor)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {mismatchMotors.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">型号不符（{mismatchMotors.length}）</p>
            <ul className="space-y-1">
              {mismatchMotors.map((motor) => {
                const axis = online.motorById.get(motor.id)?.axis;
                return (
                  <li key={motor.id} className={rowClass}>
                    <span className="min-w-0 flex-1 truncate font-mono text-warning tabular-nums">
                      {motorName(motor)}
                    </span>
                    {axis ? (
                      <span className="shrink-0 truncate text-muted-foreground">
                        {formatRealAxisModel(axis)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {offlineMotors.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">
              离线（{offlineMotors.length}）
            </p>
            <ul className="space-y-1">
              {offlineMotors.map((motor) => (
                <li key={motor.id} className={`${rowClass} justify-between`}>
                  <span className="font-mono tabular-nums text-muted-foreground">{motorName(motor)}</span>
                  <label className="inline-flex items-center gap-2 text-muted-foreground pointer-coarse:min-h-11">
                    <Checkbox
                      checked={removeIds.has(motor.id)}
                      onCheckedChange={(checked) => toggleRemove(motor.id, checked === true)}
                      aria-label={`从工程删除 ${motorName(motor)}`}
                    />
                    删除
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {discovered.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">待加入（{discovered.length}）</p>
            <ul className="space-y-1">
              {discovered.map((axis) => (
                <li key={axisKey(axis)} className="rounded-md border border-dashed border-border bg-accent/40 px-3 py-1.5">
                  <label className="flex min-h-7 cursor-pointer items-center gap-2 text-body-sm pointer-coarse:min-h-11">
                    <Checkbox
                      checked={adoptKeys.has(axisKey(axis))}
                      onCheckedChange={() => toggleAdopt(axis)}
                      aria-label={`加入工程 ${formatRealAxisPosition(axis)}`}
                    />
                    <span className="font-mono text-mono-sm tabular-nums text-foreground">
                      {formatRealAxisPosition(axis)}
                    </span>
                    <span className={axis.productModel ? "text-muted-foreground" : "text-warning"}>
                      {formatRealAxisModel(axis)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {adoptAxes.length > 0 || removeIds.size > 0 ? (
          <div className="space-y-2 rounded-md bg-muted p-3">
            <p className="text-body-sm text-muted-foreground">
              待应用：加入 {adoptAxes.length} · 删除 {removeIds.size}
            </p>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-body-sm font-semibold text-primary-foreground pointer-coarse:h-11"
            >
              应用对账
            </button>
          </div>
        ) : null}
      </div>
    </CollapsePanel>
  );
};
