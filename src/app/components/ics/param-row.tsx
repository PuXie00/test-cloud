import { Lock } from "lucide-react";
import { cn } from "../ui/utils";

type ParamRowProps = {
  label: string;
  value: string;
  unit?: string;
  locked?: boolean;
  className?: string;
};

export const ParamRow = ({ label, value, unit, locked, className }: ParamRowProps) => (
  <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
    <span className="shrink-0 text-body-sm text-muted-foreground">{label}</span>
    <div className="flex min-w-[130px] items-center justify-end gap-1.5 rounded-sm border border-border bg-input-background px-2 py-1">
      <span className="text-mono-md tabular-nums text-foreground">{value}</span>
      {unit && <span className="text-mono-sm text-muted-foreground">{unit}</span>}
      {locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
    </div>
  </div>
);
