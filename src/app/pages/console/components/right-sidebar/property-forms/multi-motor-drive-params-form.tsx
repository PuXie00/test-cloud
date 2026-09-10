import { useEffect, useMemo, useState } from "react";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { NumericInput } from "@/app/components/ics/numeric-input";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Select } from "@/app/components/ui/select";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { loadMotorModelConfig } from "@/app/pages/console/hooks/motor-config";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { isLengthFamilyUnit, normalizeLengthFamilyUnit } from "@/app/project/display-length-units";
import type { DisplayAttribute } from "@shared/config";
import type { Motor } from "../config-wizard/config-wizard-types";
import {
  AXIS_TYPE_OPTIONS,
  FIXED_MOTOR_DRIVE_PARAM_IDS,
  enumOptionsFromAttr,
  formatDriveAttrLabel,
  indexAttributesById,
  isFixedMotorDriveParamId,
  resolveAxisType,
  resolveDriveFieldHelp,
  resolveDriveFieldLabel,
  resolveDriveFieldUnit,
  type FixedMotorDriveParamId,
} from "./motor-drive-params";

type MultiMotorDriveParamsFormProps = {
  motorIds: number[];
};

const MIXED = Symbol("mixed");

type SharedValue = number | boolean | string | typeof MIXED | undefined;

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
  }
  return a === b;
};

const getSharedParam = (motors: Motor[], key: string): SharedValue => {
  if (motors.length === 0) return undefined;
  const first = motors[0]?.params[key];
  for (let i = 1; i < motors.length; i += 1) {
    if (!valuesEqual(motors[i]?.params[key], first)) return MIXED;
  }
  return first as number | boolean | string | undefined;
};

export const MultiMotorDriveParamsForm = ({ motorIds }: MultiMotorDriveParamsFormProps) => {
  const displayUnit = useSessionDisplayLengthUnit();
  const { motors, updateMotor } = useProjectStore();
  const [configAttributes, setConfigAttributes] = useState<DisplayAttribute[]>([]);
  const [variableConfig, setVariableConfig] = useState<DisplayAttribute[]>([]);

  const selectedMotors = useMemo(
    () =>
      motorIds
        .map((id) => motors.find((motor) => motor.id === id))
        .filter((motor): motor is Motor => Boolean(motor)),
    [motorIds, motors],
  );

  const modelType = selectedMotors[0]?.productModel || "";

  useEffect(() => {
    if (!modelType) return;
    let cancelled = false;
    void loadMotorModelConfig(modelType).then((config) => {
      if (cancelled || !config) return;
      setConfigAttributes(config.configAttributes);
      setVariableConfig(config.variableConfig);
    });
    return () => {
      cancelled = true;
    };
  }, [modelType]);

  const attrById = useMemo(() => indexAttributesById(configAttributes), [configAttributes]);

  if (selectedMotors.length < 2) return null;

  const sharedAxisType = (() => {
    if (selectedMotors.length === 0) return undefined;
    const first = selectedMotors[0]!.axisType;
    for (let i = 1; i < selectedMotors.length; i += 1) {
      if (selectedMotors[i]!.axisType !== first) return MIXED;
    }
    return first;
  })();
  const axisType = resolveAxisType(sharedAxisType === MIXED ? undefined : sharedAxisType);
  const axisTypeAttr = attrById.get("axisType");

  const handleNumberChange = (key: string, next: number) => {
    for (const motor of selectedMotors) {
      updateMotor(motor.id, { params: { ...motor.params, [key]: next } });
    }
  };

  const handleEnumChange = (key: string, next: string) => {
    const numeric = Number(next);
    const value = Number.isFinite(numeric) ? numeric : next;
    for (const motor of selectedMotors) {
      updateMotor(motor.id, { params: { ...motor.params, [key]: value } });
    }
  };

  const renderNumeric = (
    id: string,
    label: string,
    unit: string | undefined,
    mixed: boolean,
    shared: SharedValue,
    min?: number,
    max?: number,
  ) => {
    const canonicalUnit = unit ? normalizeLengthFamilyUnit(unit) : "";
    const value = mixed ? 0 : Number(shared ?? 0);
    const common = {
      "aria-label": label,
      mixed,
      value,
      onChange: (next: number) => handleNumberChange(id, next),
      onCommit: (next: number) => handleNumberChange(id, next),
      min,
      max,
      step: 1,
      precision: 0,
    } as const;

    if (isLengthFamilyUnit(canonicalUnit)) {
      return <UnitAwareNumericInput {...common} unit={canonicalUnit} precision={1} />;
    }
    return <NumericInput {...common} unit={canonicalUnit || undefined} />;
  };

  const renderFixedField = (id: FixedMotorDriveParamId) => {
    const attr = attrById.get(id);
    if (!attr) return null;
    const shared = getSharedParam(selectedMotors, id);
    const mixed = shared === MIXED;
    const label = resolveDriveFieldLabel(id, attr, axisType, displayUnit);
    const help = resolveDriveFieldHelp(id, axisType, displayUnit);
    const unit = resolveDriveFieldUnit(id, attr, axisType);

    if (attr.dataType === "enum") {
      return (
        <div key={id} className="flex min-h-9 items-center gap-3" title={help}>
          <span className="w-24 shrink-0 truncate text-body-sm text-muted-foreground">{label}</span>
          <div className="min-w-0 flex-1">
            <Select
              aria-label={label}
              options={enumOptionsFromAttr(attr)}
              value={mixed ? undefined : String(shared ?? "")}
              placeholder={mixed ? "多项不同" : undefined}
              onValueChange={(next) => handleEnumChange(id, next)}
            />
          </div>
        </div>
      );
    }

    return (
      <div key={id} className="flex min-h-9 items-center gap-3" title={help}>
        <span className="w-24 shrink-0 truncate text-body-sm text-muted-foreground">{label}</span>
        <div className="min-w-0 flex-1">
          {renderNumeric(id, label, unit, mixed, shared, attr.min, attr.max)}
        </div>
      </div>
    );
  };

  const extraVariableAttrs = variableConfig.filter(
    (attr) => !isFixedMotorDriveParamId(attr.id) && attr.id !== "axisType",
  );

  return (
    <div className="min-w-0 space-y-2 p-3">
      <CollapsePanel title="基础信息" defaultOpen>
        <div
          className="flex min-h-9 items-center gap-3"
          title="由绑定物体的控制类型决定，不可手改"
        >
          <span className="w-24 shrink-0 truncate text-body-sm text-muted-foreground">轴类型</span>
          <div className="min-w-0 flex-1">
            <Select
              disabled
              aria-label="轴类型"
              options={
                axisTypeAttr ? enumOptionsFromAttr(axisTypeAttr) : [...AXIS_TYPE_OPTIONS]
              }
              value={sharedAxisType === MIXED ? undefined : String(sharedAxisType ?? "")}
              placeholder={sharedAxisType === MIXED ? "多项不同" : undefined}
            />
          </div>
        </div>
      </CollapsePanel>
      <CollapsePanel title="驱动参数" defaultOpen>
        <div className="space-y-3">
          {configAttributes.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">正在加载型号参数…</p>
          ) : (
            <>
              {FIXED_MOTOR_DRIVE_PARAM_IDS.map((id) => renderFixedField(id))}
              {extraVariableAttrs.map((attr) => {
                const shared = getSharedParam(selectedMotors, attr.id);
                const mixed = shared === MIXED;
                const label = formatDriveAttrLabel(attr, displayUnit);

                if (attr.dataType === "enum") {
                  return (
                    <div key={attr.id} className="flex min-h-9 items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-body-sm text-muted-foreground">
                        {label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Select
                          aria-label={label}
                          options={enumOptionsFromAttr(attr)}
                          value={mixed ? undefined : String(shared ?? "")}
                          placeholder={mixed ? "多项不同" : undefined}
                          onValueChange={(next) => handleEnumChange(attr.id, next)}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={attr.id} className="flex min-h-9 items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-body-sm text-muted-foreground">
                      {label}
                    </span>
                    <div className="min-w-0 flex-1">
                      {renderNumeric(attr.id, label, attr.unit, mixed, shared, attr.min, attr.max)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </CollapsePanel>
    </div>
  );
};
