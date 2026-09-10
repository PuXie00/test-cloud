import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";
import { formatMonitorSpeed } from "../../monitor-grid/monitor-display";

type DetailDriveUnitsProps = { snapshot: ControlledObjectSnapshot };

export const DetailDriveUnits = ({ snapshot }: DetailDriveUnitsProps) => {
  const displayUnit = useSessionDisplayLengthUnit();

  return (
    <section className="space-y-1 border-t border-border px-3 py-3">
      <div className="text-label-caps text-muted-foreground">驱动单元</div>
      <div className="space-y-1 text-body-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">速度</span>
          <span className="font-mono tabular-nums text-foreground">
            {formatMonitorSpeed(snapshot.speed, displayUnit)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">扭矩</span>
          <span className="font-mono tabular-nums text-foreground">
            {snapshot.torquePercent.toFixed(0)} %
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">温度</span>
          <span className="font-mono tabular-nums text-foreground">
            {snapshot.temperatureC.toFixed(0)} °C
          </span>
        </div>
      </div>
    </section>
  );
};
