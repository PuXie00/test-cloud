import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { virtualAxisLabel, virtualAxisStep } from "./virtual-axis-edit";

/** 一行虚轴输入：动作页「多选位姿」和手动控制页「维度控制」共用 */
export const VirtualAxisRow = ({
  axis,
  value,
  mixed = false,
  unit,
  min,
  max,
  disabled,
  onChange,
  onCommit,
}: {
  axis: VirtualAxisId;
  value: number;
  /** 多选时各物体的值不一致，输入区显示 -- */
  mixed?: boolean;
  /** 各物体单位不一致时不传 */
  unit?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) => {
  const axisLabel = virtualAxisLabel(axis);
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-body-sm text-foreground">{axisLabel}</span>
      <UnitAwareNumericInput
        aria-label={axisLabel}
        value={value}
        mixed={mixed}
        unit={unit}
        step={virtualAxisStep(axis)}
        precision={1}
        min={min}
        max={max}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
        className="w-full border-border border"
      />
    </div>
  );
};
