type ObjectSparklineProps = {
  values: number[];
  warning?: boolean;
};

export const ObjectSparkline = ({ values, warning }: ObjectSparklineProps) => {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 100;
  const height = 16;
  const points = values
    .map((value, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-4 w-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={warning ? "var(--warning)" : "var(--primary)"}
        strokeWidth="1.2"
        points={points}
      />
    </svg>
  );
};
