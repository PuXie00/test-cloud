import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { Checkbox } from "@/app/components/ui/checkbox";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { reconcileMotorsByOrder } from "@/app/pages/console/hooks/plc-reconciliation";
import type { ScannedAxis } from "@/app/pages/console/hooks/plc-runtime-types";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";

type MotorReconciliationPanelProps = {
  plcId: number;
  defaultOpen?: boolean;
};

export const MotorReconciliationPanel = ({
  plcId,
  defaultOpen = false,
}: MotorReconciliationPanelProps) => {
  const { findPlc, getPlcMotors, addMotorsFromScannedAxes, removeMotors } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();
  const plc = findPlc(plcId);
  const runtime = getPlcRuntime(plcId);
  const configuredMotors = getPlcMotors(plcId);

  const reconciliation = useMemo(
    () => reconcileMotorsByOrder(configuredMotors, runtime.scannedAxes ?? []),
    [configuredMotors, runtime.scannedAxes],
  );

  const [adoptAxes, setAdoptAxes] = useState<ScannedAxis[]>([]);
  const [removeIds, setRemoveIds] = useState<Set<number>>(new Set());

  if (!plc) return null;

  const toggleAdopt = (axis: ScannedAxis) => {
    setAdoptAxes((current) => {
      const exists = current.some((a) => a.slaveNo === axis.slaveNo);
      return exists ? current.filter((a) => a.slaveNo !== axis.slaveNo) : [...current, axis];
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
    if (adoptAxes.length > 0) addMotorsFromScannedAxes(plcId, adoptAxes);
    if (removeIds.size > 0) removeMotors([...removeIds]);
    setAdoptAxes([]);
    setRemoveIds(new Set());
    toast.success("对账变更已应用");
  };

  const isEmpty =
    reconciliation.online.length === 0 &&
    reconciliation.modelMismatch.length === 0 &&
    reconciliation.portMismatch.length === 0 &&
    reconciliation.offline.length === 0 &&
    reconciliation.discoveredOnly.length === 0;
  if (isEmpty && runtime.connection === "disconnected") return null;

  return (
    <CollapsePanel title="连接对账" defaultOpen={defaultOpen}>
      <div className="space-y-4">
        {reconciliation.online.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">已连接</p>
            <ul className="space-y-1">
              {reconciliation.online.map(({ motor }) => {
                const configured = configuredMotors.find((item) => item.id === motor.id);
                return (
                  <li key={motor.id} className="rounded-md bg-input-background px-3 py-2 text-body-sm">
                    <span className="font-mono text-show tabular-nums">
                      {configured ? formatMotorDisplayName(configuredMotors, configured) : motor.id}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {reconciliation.modelMismatch.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">型号不匹配</p>
            <ul className="space-y-1">
              {reconciliation.modelMismatch.map(({ motor }) => {
                const configured = configuredMotors.find((item) => item.id === motor.id);
                return (
                  <li key={motor.id} className="rounded-md bg-input-background px-3 py-2 text-body-sm">
                    <span className="font-mono text-warning tabular-nums">
                      {configured ? formatMotorDisplayName(configuredMotors, configured) : motor.id}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {reconciliation.portMismatch.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">从站口不匹配</p>
            <ul className="space-y-1">
              {reconciliation.portMismatch.map(({ motor }) => {
                const configured = configuredMotors.find((item) => item.id === motor.id);
                return (
                  <li key={motor.id} className="rounded-md bg-input-background px-3 py-2 text-body-sm">
                    <span className="font-mono text-warning tabular-nums">
                      {configured ? formatMotorDisplayName(configuredMotors, configured) : motor.id}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {reconciliation.offline.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">离线</p>
            <ul className="space-y-1">
              {reconciliation.offline.map((motor) => {
                const configured = configuredMotors.find((item) => item.id === motor.id);
                return (
                  <li
                    key={motor.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-input-background px-3 py-2"
                  >
                    <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
                      {configured ? formatMotorDisplayName(configuredMotors, configured) : motor.id}
                    </span>
                    <label className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
                      <Checkbox
                        checked={removeIds.has(motor.id)}
                        onCheckedChange={(checked) => toggleRemove(motor.id, checked === true)}
                        aria-label={`从工程删除 ${configured ? formatMotorDisplayName(configuredMotors, configured) : motor.id}`}
                      />
                      删除
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {reconciliation.discoveredOnly.length > 0 ? (
          <section className="space-y-2">
            <p className="text-label-caps text-muted-foreground">待加入</p>
            <ul className="space-y-2">
              {reconciliation.discoveredOnly.map((axis) => (
                <li
                  key={axis.slaveNo}
                  className="rounded-md border border-dashed border-border bg-accent/40 px-3 py-2"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-body-sm">
                    <Checkbox
                      checked={adoptAxes.some((a) => a.slaveNo === axis.slaveNo)}
                      onCheckedChange={() => toggleAdopt(axis)}
                      aria-label={`加入工程 从站#${axis.slaveNo}`}
                    />
                    <span className="font-mono text-mono-sm text-foreground">
                      从站#{axis.slaveNo} · {axis.busNo === 0 ? "C口" : "D口"}
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
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-body-sm font-semibold text-primary-foreground"
            >
              应用对账
            </button>
          </div>
        ) : null}
      </div>
    </CollapsePanel>
  );
};
