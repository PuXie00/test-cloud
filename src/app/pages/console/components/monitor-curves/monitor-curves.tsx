import { cn } from "@/app/components/ui/utils";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { useSelection } from "../../hooks/use-selection";
import { useControlledObjects } from "../../hooks/use-controlled-objects";
import { AggregatedStats } from "./aggregated-stats";
import { CurveChart } from "./curve-chart";

type MonitorCurvesProps = { className?: string };

export const MonitorCurves = ({ className }: MonitorCurvesProps) => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();
  const effectiveId = multiSelectedIds.length === 1 ? multiSelectedIds[0] : selectedId;
  const snapshot = effectiveId ? getById(effectiveId) : undefined;
  const primary = snapshot?.descriptor.dimensions[0];

  return (
    <section className={cn("flex flex-col bg-card", className)}>
      <PanelHeader title={snapshot ? `监控曲线 — ${snapshot.descriptor.name}` : "监控曲线"} />
      <div className="flex-1 overflow-y-auto">
        {multiSelectedIds.length > 1 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-body-sm text-muted-foreground">
            已选 {multiSelectedIds.length} 个受控物体。单选后可查看监控曲线。
          </div>
        ) : snapshot && primary ? (
          <div className="space-y-3 p-3">
            <CurveChart
              label={primary.label}
              unit={primary.unit}
              value={snapshot.values[primary.key] ?? 0}
              history={snapshot.history}
            />
            <CurveChart
              label="扭矩"
              unit="%"
              value={snapshot.torquePercent}
              history={Array.from({ length: 12 }, () => snapshot.torquePercent)}
              warning={snapshot.torquePercent > 70}
            />
          </div>
        ) : (
          <AggregatedStats />
        )}
      </div>
    </section>
  );
};
