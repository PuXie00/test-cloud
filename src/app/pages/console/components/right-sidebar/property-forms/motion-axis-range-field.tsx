import { UnitAwareNumericRangeInput } from "@/app/components/ics/unit-aware-numeric-range-input";
import type { MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";
import type { StrokeLimits } from "@/app/project/stroke-limits";
import { MOTION_AXIS_FIELD_DEFINITIONS } from "../config-wizard/config-descriptors";
import { AXIS_RANGE_CONFIG } from "./motion-axis-range";

type MotionAxisRangeFieldProps = {
  axis: MotionAxisKind;
  value: MotionAxisParams;
  onChange: (value: MotionAxisParams) => void;
  /** 该物体类型的行程范围（每种类型不同）；没有时不限 */
  limits?: StrokeLimits;
};

export const MotionAxisRangeField = ({ axis, value, onChange, limits }: MotionAxisRangeFieldProps) => {
  const rangeConfig = AXIS_RANGE_CONFIG[axis];
  const rangeFieldSpec = MOTION_AXIS_FIELD_DEFINITIONS[axis].find(
    (field) => field.key === rangeConfig.specKey,
  );
  if (!rangeFieldSpec) return null;

  return (
    <div className="space-y-1">
      <span className="text-body-sm text-muted-foreground">{rangeConfig.label}</span>
      <UnitAwareNumericRangeInput
        value={{
          min: value[rangeConfig.minKey],
          max: value[rangeConfig.maxKey],
        }}
        onChange={(range) =>
          onChange({
            ...value,
            [rangeConfig.minKey]: range.min,
            [rangeConfig.maxKey]: range.max,
          })
        }
        min={limits?.minStroke.min}
        minCeiling={limits?.minStroke.max}
        maxFloor={limits?.maxStroke.min}
        max={limits?.maxStroke.max}
        unit={rangeFieldSpec.unit}
        step={rangeFieldSpec.step ?? 1}
        precision={rangeFieldSpec.precision ?? 1}
        minAriaLabel={rangeConfig.minAriaLabel}
        maxAriaLabel={rangeConfig.maxAriaLabel}
      />
    </div>
  );
};
