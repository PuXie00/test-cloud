import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  deviceKey,
  motorLabel,
  type LogSnapshotSeries,
  type LogTimeRange,
} from "@shared/csocket/operation-log";
import {
  getDisplayLengthFamilyUnit,
  toDisplayLengthValue,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";

/** 设备曲线配色：深色背景下三色两两可分（含色觉障碍）；一台设备选中期间颜色不变 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70"];

type Metric = "torque" | "position" | "speed";

type TrendChartSpec = {
  key: string;
  title: string;
  unit: string;
  metric: Metric;
  series: LogSnapshotSeries[];
};

const METRIC_TITLE: Record<Metric, string> = { torque: "转矩", position: "位置", speed: "速度" };

/** 快照只有电机：位置 mm、速度 mm/s，按显示单位换算 */
const metricUnit = (metric: Metric, display: DisplayLengthUnit) => {
  if (metric === "torque") return "%";
  return getDisplayLengthFamilyUnit(metric === "speed" ? "mm/s" : "mm", display);
};

const buildChartSpecs = (series: LogSnapshotSeries[], display: DisplayLengthUnit): TrendChartSpec[] =>
  (["torque", "position", "speed"] as const).map((metric) => ({
    key: metric,
    title: METRIC_TITLE[metric],
    unit: metricUnit(metric, display),
    metric,
    series,
  }));

const toDisplayValue = (value: number, metric: Metric, display: DisplayLengthUnit) =>
  metric === "torque" ? value : toDisplayLengthValue(value, display);

type Row = { x: number } & Record<string, number>;

const buildRows = (
  spec: TrendChartSpec,
  alarmTime: number,
  display: DisplayLengthUnit,
): Row[] => {
  const byT = new Map<number, Row>();
  for (const s of spec.series) {
    const key = deviceKey(s);
    for (const point of s.points) {
      let row = byT.get(point.t);
      if (!row) {
        row = { x: Math.round((point.t - alarmTime) / 10) / 100 } as Row;
        byT.set(point.t, row);
      }
      const value = point[spec.metric];
      if (value != null) row[key] = toDisplayValue(value, spec.metric, display);
    }
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
};

const formatSeconds = (value: number) =>
  value === 0 ? "0s" : `${value > 0 ? "+" : "−"}${Math.abs(value)}s`;

const formatAxisValue = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 10_000) return `${Math.round(value / 1000)}k`;
  if (abs >= 100) return Math.round(value).toString();
  return (Math.round(value * 10) / 10).toString();
};

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 10 };

type TrendTooltipProps = TooltipProps<number, string> & {
  unit: string;
  colorOf: (key: string) => string;
};

const TrendTooltip = ({ active, payload, label, unit, colorOf }: TrendTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-border bg-popover px-2 py-1.5 shadow-md">
      <p className="font-mono text-mono-sm text-muted-foreground">
        {formatSeconds(Number(label))}
      </p>
      {payload.map((item) => (
        <p key={String(item.dataKey)} className="flex items-center gap-1.5 text-body-sm text-foreground">
          <span
            className="h-0.5 w-3 rounded-full"
            style={{ backgroundColor: colorOf(String(item.dataKey)) }}
            aria-hidden
          />
          <span className="text-muted-foreground">{item.name}</span>
          <span className="ml-auto pl-2 font-mono tabular-nums">
            {typeof item.value === "number" ? item.value.toFixed(1) : "—"} {unit}
          </span>
        </p>
      ))}
    </div>
  );
};

type TrendChartsProps = {
  series: LogSnapshotSeries[];
  colorOf: (key: string) => string;
  alarmTime: number;
  range: LogTimeRange;
  /** 时段内操作时刻（相对报警，ms） */
  operationOffsetsMs: number[];
  cursorOffsetMs: number | null;
  /** 点击曲线定位游标（绝对时间） */
  onCursorChange: (t: number) => void;
};

export const TrendCharts = ({
  series,
  colorOf,
  alarmTime,
  range,
  operationOffsetsMs,
  cursorOffsetMs,
  onCursorChange,
}: TrendChartsProps) => {
  const display = useSessionDisplayLengthUnit();
  const specs = useMemo(() => buildChartSpecs(series, display), [series, display]);
  const xMin = (range.start - alarmTime) / 1000;
  const xMax = (range.end - alarmTime) / 1000;
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let x = Math.ceil(xMin / 2.5) * 2.5; x <= xMax; x += 2.5) ticks.push(x);
    return ticks;
  }, [xMin, xMax]);

  if (series.length === 0) {
    return <p className="px-1 text-body-sm text-muted-foreground">请选择要查看曲线的设备</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-body-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-destructive" aria-hidden />
          报警时刻
        </span>
        {operationOffsetsMs.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 border-l border-dashed border-primary" aria-hidden />
            操作
          </span>
        )}
      </div>
      {specs.map((spec, index) => {
        const rows = buildRows(spec, alarmTime, display);
        const showXAxis = index === specs.length - 1;
        return (
          <figure key={spec.key} className="m-0">
            <figcaption className="flex items-baseline justify-between px-1 text-label-caps text-muted-foreground">
              <span>{spec.title}</span>
              <span className="normal-case">{spec.unit}</span>
            </figcaption>
            <div className={showXAxis ? "h-[118px]" : "h-[96px]"}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={rows}
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                  onClick={(state) => {
                    const x = Number(state?.activeLabel);
                    if (Number.isFinite(x)) onCursorChange(alarmTime + x * 1000);
                  }}
                  className="cursor-crosshair"
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[xMin, xMax]}
                    ticks={xTicks}
                    tickFormatter={formatSeconds}
                    tick={showXAxis ? AXIS_TICK : false}
                    height={showXAxis ? 20 : 2}
                    tickLine={false}
                    stroke="var(--border)"
                    allowDataOverflow
                  />
                  <YAxis
                    width={40}
                    tick={AXIS_TICK}
                    tickFormatter={formatAxisValue}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickCount={4}
                  />
                  <Tooltip
                    content={<TrendTooltip unit={spec.unit} colorOf={colorOf} />}
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                    isAnimationActive={false}
                  />
                  {operationOffsetsMs.map((offset) => (
                    <ReferenceLine
                      key={offset}
                      x={offset / 1000}
                      stroke="var(--primary)"
                      strokeOpacity={0.6}
                      strokeDasharray="2 3"
                    />
                  ))}
                  <ReferenceLine x={0} stroke="var(--destructive)" strokeWidth={1.5} />
                  {cursorOffsetMs != null && (
                    <ReferenceLine x={cursorOffsetMs / 1000} stroke="var(--foreground)" strokeOpacity={0.5} />
                  )}
                  {spec.series.map((s) => (
                    <Line
                      key={deviceKey(s)}
                      dataKey={deviceKey(s)}
                      name={motorLabel(s.deviceId)}
                      type="monotone"
                      stroke={colorOf(deviceKey(s))}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>
        );
      })}
    </div>
  );
};
