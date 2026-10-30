import { UnitAwareNumericRangeInput } from "@/app/components/ics/unit-aware-numeric-range-input";
import type { MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";
import { MOTION_AXIS_FIELD_DEFINITIONS } from "../config-wizard/config-descriptors";
import { AXIS_RANGE_CONFIG } from "./motion-axis-range";

type MotionAxisRangeFieldProps = {
  axis: MotionAxisKind;
  value: MotionAxisParams;
  onChange: (value: MotionAxisParams) => void;
};

export const MotionAxisRangeField = ({ axis, value, onChange }: MotionAxisRangeFieldProps) => {
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
        unit={rangeFieldSpec.unit}
        step={rangeFieldSpec.step ?? 1}
        precision={rangeFieldSpec.precision ?? 1}
        minAriaLabel={rangeConfig.minAriaLabel}
        maxAriaLabel={rangeConfig.maxAriaLabel}
      />
    </div>
  );
};
