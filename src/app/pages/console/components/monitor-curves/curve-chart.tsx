import { cn } from "@/app/components/ui/utils";

type CurveChartProps = {
  label: string;
  unit: string;
  value: number;
  history: number[];
  warning?: boolean;
};

export const CurveChart = ({ label, unit, value, history, warning }: CurveChartProps) => {
  if (history.length === 0) return null;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(1, max - min);
  const width = 280;
  const height = 60;
  const points = history
    .map((sample, idx) => {
      const x = (idx / Math.max(1, history.length - 1)) * width;
      const y = height - ((sample - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-label-caps text-muted-foreground">{label}</span>
        <span
          className={cn(
            "font-mono text-mono-md tabular-nums",
            warning ? "text-warning" : "text-foreground"
          )}
        >
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[60px] w-full">
        <polyline
          fill="none"
          stroke={warning ? "var(--warning)" : "var(--primary)"}
          strokeWidth="1.5"
          points={points}
        />
      </svg>
    </div>
  );
};
