import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Form } from "@/app/components/ui/forms";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { getMotorIdForAxis, getObjectBoundBusNo, getObjectBoundPlcId } from "@/app/pages/console/hooks/binding-utils";
import { getPlcBusLimitsForPlc, isBusNo } from "@/app/pages/console/hooks/motor-bus";
import { loadMotorModelConfig } from "@/app/pages/console/hooks/motor-config";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  normalizeLengthFamilyUnit,
} from "@/app/project/display-length-units";
import type { DisplayAttribute } from "@shared/config";
import { formatAxisLabel } from "../config-wizard/axis-utils";
import type { BusNo, Motor } from "../config-wizard/config-wizard-types";
import {
  AXIS_TYPE,
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
} from "./motor-drive-params";

type MotorFormProps = { motorId: number };

type MotorFormValues = Omit<Motor, "busNo" | "axisType"> & {
  busNo: string;
  axisType: string;
  bindTarget: string;
};

const BIND_NONE = "__unbound__";

const BUS_OPTIONS = [
  { label: "C口", value: "0" },
  { label: "D口", value: "1" },
];

export const MotorForm = ({ motorId }: MotorFormProps) => {
  const displayUnit = useSessionDisplayLengthUnit();
  const { findMotor, findObject, findPlc, updateMotor, objects, motors, plcs, bindAxis } =
    useProjectStore();
  const motor = findMotor(motorId);
  const [configAttributes, setConfigAttributes] = useState<DisplayAttribute[]>([]);
  const [variableConfig, setVariableConfig] = useState<DisplayAttribute[]>([]);

  useEffect(() => {
    if (!motor) return;
    let cancelled = false;
    const modelType = motor.productModel;
    void loadMotorModelConfig(modelType).then((config) => {
      if (cancelled || !config) return;
      setConfigAttributes(config.configAttributes);
      setVariableConfig(config.variableConfig);
    });
    return () => {
      cancelled = true;
    };
  }, [motor?.id, motor?.productModel]);

  const attrById = useMemo(() => indexAttributesById(configAttributes), [configAttributes]);

  const boundObject =
    motor?.controlledObjectId != null ? findObject(motor.controlledObjectId) : null;
  const boundAxis =
    boundObject && motor?.axisKey
      ? boundObject.axes.find((axis) => axis.key === motor.axisKey)
      : undefined;

  const bindTarget = boundObject && boundAxis ? `${boundObject.id}:${boundAxis.key}` : BIND_NONE;

  const busLimits = motor ? getPlcBusLimitsForPlc(motor.plcId, plcs) : null;
  const dPortDisabled = busLimits !== null && busLimits.maxAxisPerD <= 0;

  const bindOptions = useMemo(
    () => [
      { label: "未绑定", value: BIND_NONE },
      ...objects.flatMap((obj) =>
        obj.axes.map((axis, axisIndex) => {
          const value = `${obj.id}:${axis.key}`;
          const occupant = getMotorIdForAxis(obj.id, axis.key, motors);
          const taken = Boolean(occupant && occupant !== motor?.id);
          return {
            label: `${obj.name} · ${formatAxisLabel(axisIndex)}${taken ? " (已占用)" : ""}`,
            value,
            disabled: taken,
          };
        }),
      ),
    ],
    [objects, motors, motor?.id],
  );

  if (!motor) return null;

  const axisType = resolveAxisType(motor.axisType);

  const handleUnbind = () => {
    if (boundObject && boundAxis) bindAxis(boundObject.id, boundAxis.key, null);
  };

  const handleBindChange = (raw: string) => {
    if (!raw || raw === BIND_NONE) {
      handleUnbind();
      return;
    }
    const [objectIdRaw, axisKey] = raw.split(":");
    const objectId = Number(objectIdRaw);
    if (!Number.isFinite(objectId)) return;
    handleUnbind();
    const ok = bindAxis(objectId, axisKey, motorId);
    if (!ok) {
      const boundPlcId = getObjectBoundPlcId(objectId, objects, motors);
      const boundBusNo = getObjectBoundBusNo(objectId, motors);
      if (boundBusNo !== null && motor.busNo !== boundBusNo) {
        toast.warning("同一受控物体不能同时绑定 C 口与 D 口电机");
        return;
      }
      if (boundPlcId != null && motor.plcId !== boundPlcId) {
        toast.warning("该受控物体已绑定其他主控的驱动单元，不可跨主控混绑");
        return;
      }
      toast.warning("绑定失败");
    }
  };

  const coerceEnumParams = (params: Motor["params"]) => {
    const nextParams = { ...params };
    for (const id of FIXED_MOTOR_DRIVE_PARAM_IDS) {
      const attr = attrById.get(id);
      if (!attr || attr.dataType !== "enum" || nextParams[id] === undefined) continue;
      const raw = nextParams[id];
      nextParams[id] = typeof raw === "number" ? raw : Number(raw);
    }
    for (const attr of variableConfig) {
      if (attr.dataType !== "enum" || nextParams[attr.id] === undefined) continue;
      const raw = nextParams[attr.id];
      nextParams[attr.id] = typeof raw === "number" ? raw : Number(raw);
    }
    return nextParams;
  };

  const handleValuesChange = (changed: Partial<MotorFormValues>, all: MotorFormValues) => {
    if ("bindTarget" in changed) {
      handleBindChange(String(changed.bindTarget ?? ""));
      return;
    }
    if ("busNo" in changed) {
      const next = Number(changed.busNo);
      if (!isBusNo(next)) return;
      const ok = updateMotor(motorId, { busNo: next as BusNo });
      if (!ok) {
        toast.warning("该从站口已达 PLC 最大接线数量");
      }
      return;
    }
    if ("axisType" in changed) {
      // 轴类型由物体控制类型/绑定状态决定，不可手改
      return;
    }
    if ("params" in changed || Object.keys(changed).some((key) => key.startsWith("params."))) {
      updateMotor(motorId, { params: coerceEnumParams(all.params) });
      return;
    }
    const {
      bindTarget: _ignored,
      busNo: _ignoredBus,
      axisType: _ignoredAxisType,
      ...motorPatch
    } = changed;
    if (Object.keys(motorPatch).length > 0) {
      updateMotor(motorId, motorPatch);
    }
  };

  const { busNo: _busNo, axisType: _axisType, ...motorFields } = motor;
  const initialParams = { ...motor.params };
  delete initialParams.axisType;
  for (const id of FIXED_MOTOR_DRIVE_PARAM_IDS) {
    const attr = attrById.get(id);
    if (!attr) continue;
    if (initialParams[id] === undefined && attr.DefaultValue !== undefined) {
      initialParams[id] = attr.DefaultValue;
    }
    if (attr.dataType === "enum" && initialParams[id] !== undefined) {
      initialParams[id] = String(initialParams[id]);
    }
  }
  for (const attr of variableConfig) {
    if (isFixedMotorDriveParamId(attr.id) || attr.id === "axisType") continue;
    if (initialParams[attr.id] === undefined && attr.DefaultValue !== undefined) {
      initialParams[attr.id] = attr.DefaultValue;
    }
    if (attr.dataType === "enum" && initialParams[attr.id] !== undefined) {
      initialParams[attr.id] = String(initialParams[attr.id]);
    }
  }
  const initialValues: MotorFormValues = {
    ...motorFields,
    busNo: String(motor.busNo),
    axisType: String(motor.axisType),
    params: initialParams,
    bindTarget,
  };

  const busSelectOptions = BUS_OPTIONS.map((option) => ({
    ...option,
    disabled: option.value === "1" && dPortDisabled,
  }));

  const axisTypeAttr = attrById.get("axisType");
  const workingStrokeAttr = attrById.get("workingStroke");
  const maxAxisVelocityAttr = attrById.get("maxAxisVelocity");
  const reductionRatioAttr = attrById.get("reductionRatio");
  const axisDirectionAttr = attrById.get("axisDirection");
  const positionErrorAttr = attrById.get("positionError");
  const weightLowAttr = attrById.get("weightLow");
  const weightHighAttr = attrById.get("weightHigh");
  const loadLowAttr = attrById.get("loadLow");
  const loadHighAttr = attrById.get("loadHigh");

  const workingStrokeUnit = workingStrokeAttr
    ? resolveDriveFieldUnit("workingStroke", workingStrokeAttr, axisType)
    : axisType === AXIS_TYPE.continuous
      ? "°"
      : "mm";
  const workingStrokeLabel = workingStrokeAttr
    ? resolveDriveFieldLabel("workingStroke", workingStrokeAttr, axisType, displayUnit)
    : axisType === AXIS_TYPE.continuous
      ? "工作行程 (°)"
      : `工作行程 (${getDisplayLengthFamilyUnit("mm", displayUnit)})`;
  const maxAxisVelocityUnit = maxAxisVelocityAttr
    ? resolveDriveFieldUnit("maxAxisVelocity", maxAxisVelocityAttr, axisType)
    : "mm/s";
  const maxAxisVelocityLabel = maxAxisVelocityAttr
    ? resolveDriveFieldLabel("maxAxisVelocity", maxAxisVelocityAttr, axisType, displayUnit)
    : "最大速度 (mm/s)";
  const positionErrorUnit = positionErrorAttr
    ? resolveDriveFieldUnit("positionError", positionErrorAttr, axisType)
    : axisType === AXIS_TYPE.continuous
      ? "°"
      : "mm";
  const positionErrorLabel = positionErrorAttr
    ? resolveDriveFieldLabel("positionError", positionErrorAttr, axisType, displayUnit)
    : axisType === AXIS_TYPE.continuous
      ? "位置偏差 (°)"
      : `位置偏差 (${getDisplayLengthFamilyUnit("mm", displayUnit)})`;

  const extraVariableAttrs = variableConfig.filter(
    (attr) => !isFixedMotorDriveParamId(attr.id) && attr.id !== "axisType",
  );

  const renderNumberField = (
    name: string | string[],
    label: string,
    unit: string | undefined,
    min?: number,
    max?: number,
    labelTitle?: string,
  ) => {
    const canonicalUnit = unit ? normalizeLengthFamilyUnit(unit) : "";
    if (isLengthFamilyUnit(canonicalUnit)) {
      return (
        <Form.Item name={name} label={label} labelTitle={labelTitle} labelWidth={120}>
          <UnitAwareNumericInput
            unit={canonicalUnit}
            min={min}
            max={max}
            step={1}
            precision={1}
            aria-label={label}
          />
        </Form.Item>
      );
    }
    return (
      <Form.Item name={name} label={label} labelTitle={labelTitle} labelWidth={120}>
        <Input
          type="number"
          showStepper
          min={min}
          max={max}
          aria-label={label}
        />
      </Form.Item>
    );
  };

  return (
    <div className="min-w-0 space-y-2 p-3">
      <Form
        key={`${motorId}-${bindTarget}-${motor.busNo}-${configAttributes.map((a) => a.id).join(",")}`}
        layout="horizontal"
        labelWidth={96}
        className="space-y-2"
        initialValues={initialValues}
        onValuesChange={handleValuesChange}
      >
        <CollapsePanel title="基础信息">
          <div className="space-y-3">
            <Form.Item label="名称">
              <Input
                readOnly
                value={formatMotorDisplayName(motors, motor)}
                aria-label="名称"
                className="font-mono tabular-nums"
              />
            </Form.Item>
            <Form.Item label="所属主控">
              <Input
                readOnly
                value={findPlc(motor.plcId) ? formatPlcDisplayName(plcs, motor.plcId) : "—"}
                aria-label="所属主控"
              />
            </Form.Item>
            <Form.Item label="从站口" name="busNo">
              <Select options={busSelectOptions} aria-label="从站口" />
            </Form.Item>
            <Form.Item
              name="axisType"
              label="轴类型"
              labelTitle={
                boundObject
                  ? "由绑定物体的控制类型决定，不可手改"
                  : resolveDriveFieldHelp("axisType", axisType, displayUnit)
              }
            >
              <Select
                disabled
                options={
                  axisTypeAttr ? enumOptionsFromAttr(axisTypeAttr) : [...AXIS_TYPE_OPTIONS]
                }
                aria-label="轴类型"
              />
            </Form.Item>
            <Form.Item label="绑定吊点" name="bindTarget">
              <Select options={bindOptions} placeholder="选择绑定" aria-label="绑定吊点" />
            </Form.Item>
          </div>
        </CollapsePanel>

        <CollapsePanel title="驱动参数" defaultOpen={false}>
          <div className="space-y-3">
            {configAttributes.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">正在加载型号参数…</p>
            ) : (
              <>
                {renderNumberField(
                  ["params", "workingStroke"],
                  workingStrokeLabel,
                  workingStrokeUnit,
                  workingStrokeAttr?.min,
                  workingStrokeAttr?.max,
                  resolveDriveFieldHelp("workingStroke", axisType, displayUnit),
                )}

                {renderNumberField(
                  ["params", "maxAxisVelocity"],
                  maxAxisVelocityLabel,
                  maxAxisVelocityUnit,
                  maxAxisVelocityAttr?.min,
                  maxAxisVelocityAttr?.max,
                  resolveDriveFieldHelp("maxAxisVelocity", axisType, displayUnit),
                )}

                <Form.Item
                  name={["params", "reductionRatio"]}
                  label={
                    reductionRatioAttr
                      ? resolveDriveFieldLabel("reductionRatio", reductionRatioAttr, axisType, displayUnit)
                      : "减速比"
                  }
                  labelTitle={resolveDriveFieldHelp("reductionRatio", axisType, displayUnit)}
                  labelWidth={120}
                >
                  <Input
                    type="number"
                    showStepper
                    min={reductionRatioAttr?.min}
                    max={reductionRatioAttr?.max}
                    aria-label="减速比"
                  />
                </Form.Item>

                <Form.Item
                  name={["params", "axisDirection"]}
                  label={
                    axisDirectionAttr
                      ? resolveDriveFieldLabel("axisDirection", axisDirectionAttr, axisType, displayUnit)
                      : "轴方向"
                  }
                  labelTitle={resolveDriveFieldHelp("axisDirection", axisType, displayUnit)}
                  labelWidth={120}
                >
                  <Select
                    options={axisDirectionAttr ? enumOptionsFromAttr(axisDirectionAttr) : []}
                    aria-label="轴方向"
                  />
                </Form.Item>

                {renderNumberField(
                  ["params", "positionError"],
                  positionErrorLabel,
                  positionErrorUnit,
                  positionErrorAttr?.min,
                  positionErrorAttr?.max,
                  resolveDriveFieldHelp("positionError", axisType, displayUnit),
                )}

                {renderNumberField(
                  ["params", "weightLow"],
                  weightLowAttr
                    ? resolveDriveFieldLabel("weightLow", weightLowAttr, axisType, displayUnit)
                    : "称重下限",
                  weightLowAttr
                    ? resolveDriveFieldUnit("weightLow", weightLowAttr, axisType)
                    : "",
                  weightLowAttr?.min,
                  weightLowAttr?.max,
                  resolveDriveFieldHelp("weightLow", axisType, displayUnit),
                )}

                {renderNumberField(
                  ["params", "weightHigh"],
                  weightHighAttr
                    ? resolveDriveFieldLabel("weightHigh", weightHighAttr, axisType, displayUnit)
                    : "称重上限",
                  weightHighAttr
                    ? resolveDriveFieldUnit("weightHigh", weightHighAttr, axisType)
                    : "",
                  weightHighAttr?.min,
                  weightHighAttr?.max,
                  resolveDriveFieldHelp("weightHigh", axisType, displayUnit),
                )}

                {renderNumberField(
                  ["params", "loadLow"],
                  loadLowAttr
                    ? resolveDriveFieldLabel("loadLow", loadLowAttr, axisType, displayUnit)
                    : "力矩下限",
                  loadLowAttr
                    ? resolveDriveFieldUnit("loadLow", loadLowAttr, axisType)
                    : "",
                  loadLowAttr?.min,
                  loadLowAttr?.max,
                  resolveDriveFieldHelp("loadLow", axisType, displayUnit),
                )}

                {renderNumberField(
                  ["params", "loadHigh"],
                  loadHighAttr
                    ? resolveDriveFieldLabel("loadHigh", loadHighAttr, axisType, displayUnit)
                    : "力矩上限",
                  loadHighAttr
                    ? resolveDriveFieldUnit("loadHigh", loadHighAttr, axisType)
                    : "",
                  loadHighAttr?.min,
                  loadHighAttr?.max,
                  resolveDriveFieldHelp("loadHigh", axisType, displayUnit),
                )}

                {extraVariableAttrs.map((attr) =>
                  attr.dataType === "enum" ? (
                    <Form.Item
                      key={attr.id}
                      name={["params", attr.id]}
                      label={formatDriveAttrLabel(attr, displayUnit)}
                      labelWidth={120}
                    >
                      <Select
                        options={enumOptionsFromAttr(attr)}
                        aria-label={formatDriveAttrLabel(attr, displayUnit)}
                      />
                    </Form.Item>
                  ) : (
                    <Fragment key={attr.id}>
                      {renderNumberField(
                        ["params", attr.id],
                        formatDriveAttrLabel(attr, displayUnit),
                        attr.unit,
                        attr.min,
                        attr.max,
                      )}
                    </Fragment>
                  ),
                )}
              </>
            )}
          </div>
        </CollapsePanel>
      </Form>
    </div>
  );
};
