import { cn } from "../ui/utils";

type DataReadoutProps = {
  label: string;
  value: string;
  unit?: string;
  className?: string;
};

export const DataReadout = ({ label, value, unit, className }: DataReadoutProps) => (
  <div className={className}>
    <div className="mb-1 text-label-caps text-muted-foreground">{label}</div>
    <div className="text-heading-xl font-mono font-bold tabular-nums text-primary">
      {value}
      {unit && <span className="ml-1 text-body-md font-normal text-muted-foreground">{unit}</span>}
    </div>
  </div>
);
