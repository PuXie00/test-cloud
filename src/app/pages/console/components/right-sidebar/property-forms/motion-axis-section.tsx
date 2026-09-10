import type { ReactNode } from "react";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import type { MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";
import {
  MOTION_AXIS_FIELD_DEFINITIONS,
  MOTION_DEFAULTS,
} from "../config-wizard/config-descriptors";

export const MOVE_DEFAULTS = MOTION_DEFAULTS.move;

type MotionAxisSectionProps = {
  axis: MotionAxisKind;
  value: MotionAxisParams;
  onChange: (value: MotionAxisParams) => void;
  /** 按字段写入（批量编辑时避免用整对象覆盖其他物体的未改字段） */
  onFieldChange?: (key: keyof MotionAxisParams, next: number) => void;
  excludeKeys?: (keyof MotionAxisParams)[];
  /** 批量：这些 key 的值在选中物体间不一致 */
  mixedKeys?: ReadonlySet<keyof MotionAxisParams>;
  autoSpeed?: {
    enabled: boolean;
    summary: ReactNode;
    customEnabled: boolean;
    customEnabledMixed?: boolean;
    onCustomEnabledChange: (enabled: boolean) => void;
  };
};

/** 自定义速度时虚轴可改的字段；最大轴速度只在物体级设置一次 */
const CUSTOM_SPEED_KEYS = new Set<keyof MotionAxisParams>(["speed"]);

export const MotionAxisSection = ({
  axis,
  value,
  onChange,
  onFieldChange,
  excludeKeys = [],
  mixedKeys,
  autoSpeed,
}: MotionAxisSectionProps) => {
  const fields = MOTION_AXIS_FIELD_DEFINITIONS[axis];
  const hiddenKeys = new Set<keyof MotionAxisParams>(excludeKeys);
  const shouldHideSpeedFields = autoSpeed?.enabled && !autoSpeed.customEnabled;
  const commonFields = fields.filter(
    (field) =>
      field.tier === "common" &&
      !hiddenKeys.has(field.key) &&
      (!shouldHideSpeedFields || !CUSTOM_SPEED_KEYS.has(field.key)),
  );
  const advancedFields = fields.filter(
    (field) =>
      field.tier === "advanced" &&
      !hiddenKeys.has(field.key) &&
      (!shouldHideSpeedFields || !CUSTOM_SPEED_KEYS.has(field.key)),
  );
  const speedFields = fields.filter((field) => CUSTOM_SPEED_KEYS.has(field.key));

  const handleFieldChange = (key: keyof MotionAxisParams, next: number) => {
    if (onFieldChange) {
      onFieldChange(key, next);
      return;
    }
    onChange({ ...value, [key]: next });
  };

  const renderField = (field: (typeof fields)[number]) => {
    const mixed = mixedKeys?.has(field.key) ?? false;
    return (
      <div key={field.key} className="space-y-1">
        <span className="text-body-sm text-muted-foreground">{field.label}</span>
        {field.control === "input" ? (
          <Input
            type="number"
            showStepper
            aria-label={field.label}
            step={field.step}
            unit={field.unit}
            selectOnFocus
            value={mixed ? "" : value[field.key]}
            placeholder={mixed ? "--" : undefined}
            onChange={(event) => handleFieldChange(field.key, Number(event.target.value))}
          />
        ) : (
          <UnitAwareNumericInput
            aria-label={field.label}
            mixed={mixed}
            value={value[field.key]}
            onChange={(next) => handleFieldChange(field.key, next)}
            unit={field.unit}
            step={field.step ?? 1}
            precision={field.precision ?? 1}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {autoSpeed?.enabled ? (
        <div className="rounded-md bg-input-background px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">{autoSpeed.summary}</div>
            <Checkbox
              checked={
                autoSpeed.customEnabledMixed
                  ? "indeterminate"
                  : autoSpeed.customEnabled
              }
              onCheckedChange={(checked) => autoSpeed.onCustomEnabledChange(checked === true)}
            >
              自定义速度
            </Checkbox>
          </div>
          {/* {autoSpeed.customEnabled || autoSpeed.customEnabledMixed ? (
            <div className="mt-3 space-y-3">{speedFields.map(renderField)}</div>
          ) : null} */}
        </div>
      ) : null}
      {commonFields.map(renderField)}
      <div className="space-y-3">{advancedFields.map(renderField)}</div>
    </div>
  );
};
