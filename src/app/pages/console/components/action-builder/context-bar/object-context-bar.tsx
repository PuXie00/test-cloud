import { Box, Power, RotateCcw } from "lucide-react";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  formatLengthFamily,
  isLengthFamilyUnit,
} from "@/app/project/display-length-units";
import type { ControlledObject } from "../timeline/timeline-data";

type ObjectContextBarProps = {
  object: ControlledObject;
};

export const ObjectContextBar = ({ object }: ObjectContextBarProps) => {
  const display = useSessionDisplayLengthUnit();
  const positionText = isLengthFamilyUnit(object.unit)
    ? formatLengthFamily(object.currentPosition, object.unit, display, {
        canonicalPrecision: 1,
      })
    : `${object.currentPosition.toFixed(1)} ${object.unit}`;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-card px-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/30">
        <Box className="h-4 w-4 text-primary" aria-hidden />
      </div>

      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-foreground">{object.name}</p>
        <p className="text-[10px] text-muted-foreground">受控物体 · {object.axisLabel}</p>
      </div>

      <div className="mx-2 h-8 w-px bg-border" aria-hidden />

      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground">当前位置</span>
        <span className="font-mono text-mono-md tabular-nums text-foreground">{positionText}</span>
      </div>

      <div className="min-w-0 flex-1" aria-hidden />

      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-body-sm hover:bg-muted"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        复位
      </button>
      <button
        type="button"
        aria-pressed={object.enabled}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-body-sm hover:bg-muted"
      >
        <Power className="h-3.5 w-3.5" aria-hidden />
        {object.enabled ? "已使能" : "未使能"}
      </button>
    </div>
  );
};
