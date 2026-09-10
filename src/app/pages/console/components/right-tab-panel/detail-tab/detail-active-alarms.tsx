import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";

type DetailActiveAlarmsProps = { snapshot: ControlledObjectSnapshot };

export const DetailActiveAlarms = ({ snapshot }: DetailActiveAlarmsProps) => {
  const hasAlarm = snapshot.descriptor.status === "alarm" || snapshot.descriptor.status === "warning";
  return (
    <section className="space-y-1 border-t border-border px-3 py-3">
      <div className="text-label-caps text-muted-foreground">当前报警</div>
      {hasAlarm ? (
        <p className="rounded-sm bg-warning/10 px-2 py-1 text-body-sm text-warning">
          {snapshot.descriptor.status === "alarm" ? "存在报警 — 请处理" : "存在警告 — 请关注"}
        </p>
      ) : (
        <p className="text-body-sm text-muted-foreground">无</p>
      )}
    </section>
  );
};
