import {
  deviceKey,
  motorLabel,
  type LogSnapshotPoint,
  type LogSnapshotSeries,
} from "@shared/csocket/operation-log";
import { formatLengthFamily } from "@/app/project/display-length-units";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";

/** t 时刻（含）之前最近的采样点；早于第一个点时取第一个 */
export const sampleAt = (points: readonly LogSnapshotPoint[], t: number): LogSnapshotPoint | null => {
  if (points.length === 0) return null;
  if (t <= points[0].t) return points[0];
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo];
};

type SnapshotTableProps = {
  snapshot: LogSnapshotSeries[];
  at: number;
};

/** 快照只有电机：位置 mm、速度 mm/s */
export const SnapshotTable = ({ snapshot, at }: SnapshotTableProps) => {
  const displayUnit = useSessionDisplayLengthUnit();
  const format = (value: number | undefined, unit: string) =>
    value == null ? "—" : formatLengthFamily(value, unit, displayUnit, { canonicalPrecision: 1 });

  return (
    <table className="w-full table-fixed text-body-sm">
      <colgroup>
        <col className="w-[26%]" />
        <col />
        <col />
        <col className="w-[15%]" />
        <col className="w-[15%]" />
      </colgroup>
      <thead>
        <tr className="text-left text-label-caps text-muted-foreground">
          <th className="px-2 py-1 font-normal">设备</th>
          <th className="px-2 py-1 text-right font-normal">位置</th>
          <th className="px-2 py-1 text-right font-normal">速度</th>
          <th className="px-2 py-1 text-right font-normal">转矩</th>
          <th className="px-2 py-1 text-right font-normal">温度</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.map((series) => {
          const key = deviceKey(series);
          const point = sampleAt(series.points, at);
          return (
            <tr key={key} className="border-t border-border/40">
              <td className="truncate px-2 py-1 text-foreground">{motorLabel(series.deviceId)}</td>
              <td className="truncate px-2 py-1 text-right font-mono text-mono-sm tabular-nums">
                {format(point?.position, "mm")}
              </td>
              <td className="truncate px-2 py-1 text-right font-mono text-mono-sm tabular-nums">
                {format(point?.speed, "mm/s")}
              </td>
              <td className="truncate px-2 py-1 text-right font-mono text-mono-sm tabular-nums">
                {point?.torque == null ? "—" : `${point.torque.toFixed(1)} %`}
              </td>
              <td className="truncate px-2 py-1 text-right font-mono text-mono-sm tabular-nums">
                {point?.temperature == null ? "—" : `${point.temperature.toFixed(1)} ℃`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
