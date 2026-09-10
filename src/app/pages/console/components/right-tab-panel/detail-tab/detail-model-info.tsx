import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import type { ControlledObjectSnapshot } from "../../monitor-grid/monitor-data";
import { formatMonitorDimension } from "../../monitor-grid/monitor-display";

type DetailModelInfoProps = { snapshot: ControlledObjectSnapshot };

export const DetailModelInfo = ({ snapshot }: DetailModelInfoProps) => {
  const displayUnit = useSessionDisplayLengthUnit();

  return (
    <section className="space-y-1 px-3 py-3">
      <div className="text-label-caps text-muted-foreground">模型信息</div>
      {snapshot.descriptor.dimensions.map((dim) => (
        <div key={dim.key} className="flex items-center justify-between text-body-sm">
          <span className="text-muted-foreground">{dim.label}</span>
          <span className="font-mono tabular-nums text-foreground">
            {formatMonitorDimension(snapshot.values[dim.key] ?? 0, dim.unit, displayUnit)}
          </span>
        </div>
      ))}
    </section>
  );
};
