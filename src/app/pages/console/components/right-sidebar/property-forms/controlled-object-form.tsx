import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { Button } from "@/app/components/ui/button";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { NumericInputGroup } from "@/app/components/ics/numeric-input-group";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { UnitAwareNumericRangeInput } from "@/app/components/ics/unit-aware-numeric-range-input";
import { Form } from "@/app/components/ui/forms";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Slider } from "@/app/components/ui/slider";
import {
  modelRotationAxesForControlType,
  normalizeObjectRotationDeg,
} from "@/app/project/object-rotation";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ControlType, MotionAxisKind, MotionAxisParams } from "@/app/project/configuration-types";
import { normalizeMotionAxisParams } from "@/app/project/motion-acceleration";
import {
  deriveMotionParamsFromSpeedControl,
  inferMotionSpeedControl,
  type MotionSpeedControl,
} from "@/app/project/motion-speed";
import {
  DEFAULT_SWING_AXIS_MAX_VELOCITY,
  clampMotionParamsToAxisMax,
  resolveVirtualAxisMaxVelocity,
} from "@/app/project/virtual-axis-max-velocity";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { getVirtualAxisMeta } from "@/app/pages/console/components/action-builder/virtual-axis-display";
import { mmVec3ToM } from "@/app/project/length-units";
import { useProject } from "@/app/project/use-project";
import { useViz3DContext } from "@/app/pages/console/3d/Viz3DProvider";
import { loadProjectModel } from "@/app/pages/console/3d/ensure-project-models";
import { persistPivotChanges } from "@/app/pages/console/3d/viz3d-transform-persist";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import {
  analyzeControlTypeChangeImpact,
  EMPTY_CONTROL_TYPE_CHANGE_IMPACT,
  type ControlTypeChangeImpact,
} from "@/app/pages/console/hooks/control-type-change";
import {
  CONTROL_TYPE_DEFINITION_BY_ID,
  defaultShapeDimensions,
  MOTION_AXIS_FIELD_DEFINITIONS,
  MOTION_AXIS_LABELS,
  MOTION_DEFAULTS,
  SHAPE_DEFINITIONS,
  toEngineDimensions,
} from "../config-wizard/config-descriptors";
import { ObjectAxesEditor } from "../config-wizard/object-axes-editor";
import { OBJECT_COLORS } from "../config-wizard/config-wizard-constants";
import type { ControlledObject, ShapePresetId } from "../config-wizard/config-wizard-types";
import { ControlTypeSelector } from "./control-type-selector";
import { ControlTypeChangeConfirmDialog } from "./control-type-change-confirm-dialog";
import { AXIS_RANGE_CONFIG } from "./motion-axis-range";
import { MotionAxisSection } from "./motion-axis-section";
import { ProjectModelLibraryDialog } from "./project-model-library-dialog";
import { ShapeDimensionFields } from "./shape-dimension-fields";

type ControlledObjectFormProps = { objectId: number };

const VECTOR_PREFIX_COLORS = {
  x: "var(--destructive)",
  y: "var(--show)",
  z: "var(--primary)",
} as const;

const shapeDimensionsFromObject = (object: ControlledObject) => object.shapeDimensions;

const enabledVirtualAxesOf = (controlType: ControlType): readonly VirtualAxisId[] =>
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType];

const modelFileName = (modelId?: string | null): string => {
  if (!modelId) return "";
  const normalized = modelId.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || modelId;
};

export const ControlledObjectForm = ({ objectId }: ControlledObjectFormProps) => {
  const {
    findObject,
    updateObject,
    changeObjectControlType,
    getObjectBoundPlcId,
    findPlc,
    plcs,
    motors,
  } = useProjectStore();
  const { currentProject } = useProject();
  const engine = useViz3DContext();
  const object = findObject(objectId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingControlType, setPendingControlType] = useState<ControlType | null>(null);
  const [pendingImpact, setPendingImpact] = useState<ControlTypeChangeImpact | null>(null);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);

  const shapeOptions = useMemo(
    () =>
      SHAPE_DEFINITIONS.map((shape) => ({
        label: shape.label,
        value: shape.id,
      })),
    [],
  );

  const openModelLibrary = useCallback(() => {
    if (!currentProject) {
      toast.error("请先打开工程");
      return;
    }
    setModelLibraryOpen(true);
  }, [currentProject]);

  const handleShapePresetChange = useCallback(
    (shapePreset: ShapePresetId) => {
      if (shapePreset === "external") {
        openModelLibrary();
        return;
      }

      const nextDimensions = defaultShapeDimensions(shapePreset);
      updateObject(objectId, {
        shapePreset,
        shapeDimensions: nextDimensions,
        dimensions: toEngineDimensions(shapePreset, nextDimensions),
        modelId: undefined,
      });
    },
    [objectId, openModelLibrary, updateObject],
  );

  const handleApplyModel = useCallback(
    (modelId: string) => {
      void (async () => {
        try {
          await loadProjectModel(modelId, engine);
          const nativeSize = engine.getModelNativeSizeMm?.(modelId);
          const nextDimensions = nativeSize ?? defaultShapeDimensions("external");
          updateObject(objectId, {
            shapePreset: "external",
            modelId,
            shapeDimensions: nextDimensions,
            dimensions: toEngineDimensions("external", nextDimensions),
          });
        } catch {
          toast.error("模型加载失败，已回退显示");
        }
      })();
    },
    [engine, objectId, updateObject],
  );

  const handleValuesChange = useCallback(
    (changed: Partial<ControlledObject>, all: ControlledObject) => {
      const key = Object.keys(changed)[0];
      if (!key) return;

      if (key === "controlType") return;

      if (key === "shapePreset") {
        handleShapePresetChange(changed.shapePreset!);
        return;
      }

      if (key.includes(".")) {
        const [parent, child] = key.split(".") as [keyof ControlledObject, string];
        const parentValue = all[parent];
        if (parentValue && typeof parentValue === "object") {
          const nextParent = {
            ...(parentValue as object),
            [child]: changed[key as keyof ControlledObject],
          };
          updateObject(objectId, {
            [parent]:
              parent === "rotation"
                ? normalizeObjectRotationDeg(nextParent, all.controlType)
                : nextParent,
          } as Partial<ControlledObject>);
        }
        return;
      }

      updateObject(objectId, { [key]: changed[key as keyof ControlledObject] } as Partial<ControlledObject>);
    },
    [objectId, updateObject, handleShapePresetChange],
  );

  const handleTransformCenterChange = useCallback(
    (axis: "x" | "y" | "z", value: number) => {
      const current = findObject(objectId);
      if (!current) {
        return;
      }
      const centerOffset = { ...current.centerOffset, [axis]: value };
      const engineObjectId = String(objectId);
      const payload = engine.setPivot(engineObjectId, mmVec3ToM(centerOffset));
      if (!payload) {
        if (!engine.getObjectIds().includes(engineObjectId)) {
          updateObject(objectId, { centerOffset });
        }
        return;
      }
      persistPivotChanges(updateObject, [payload]);
    },
    [engine, findObject, objectId, updateObject],
  );

  if (!object) return null;

  const motionAxes = CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes;
  const shapeDimensions = shapeDimensionsFromObject(object);
  const motionParams = object.motionParams ?? {};
  const maxAxisVelocity = object.maxAxisVelocity;
  const speedControl =
    object.motionSpeedControl ?? inferMotionSpeedControl(motionParams, maxAxisVelocity);
  const resolvedMaxByAxis = resolveVirtualAxisMaxVelocity(
    {
      id: object.id,
      enabledVirtualAxes: enabledVirtualAxesOf(object.controlType),
      pDefaultMaxVelocity: object.pDefaultMaxVelocity,
      yDefaultMaxVelocity: object.yDefaultMaxVelocity,
    },
    motors,
  );

  const boundPlcName = (() => {
    const plcId = getObjectBoundPlcId(objectId);
    const plc = plcId ? findPlc(plcId) : null;
    return plc ? formatPlcDisplayName(plcs, plc) : "未关联（由已绑驱动单元推导）";
  })();

  const applyShapeDimensions = (nextDimensions: ControlledObject["shapeDimensions"]) => {
    if (!nextDimensions) return;
    updateObject(objectId, {
      shapeDimensions: nextDimensions,
      dimensions: toEngineDimensions(object.shapePreset, nextDimensions),
    });
  };

  const handleControlTypeChange = (controlType: ControlType) => {
    const document = currentProject?.document;
    if (!document) return;
    const impact = analyzeControlTypeChangeImpact(document, [objectId], controlType);
    if (!impact.changed) {
      changeObjectControlType([objectId], controlType);
      return;
    }
    setPendingControlType(controlType);
    setPendingImpact(impact);
    setConfirmOpen(true);
  };

  const handleConfirmControlTypeChange = () => {
    if (pendingControlType) {
      const result = changeObjectControlType([objectId], pendingControlType);
      if (!result.ok) toast.error(result.reason);
    }
    setPendingControlType(null);
    setPendingImpact(null);
    setConfirmOpen(false);
  };

  const pendingTargetLabel = pendingControlType
    ? CONTROL_TYPE_DEFINITION_BY_ID[pendingControlType].label
    : "";

  const handleMotionAxisChange = (axis: MotionAxisKind, value: MotionAxisParams) => {
    const normalized = normalizeMotionAxisParams(value);
    const override = speedControl.overrides?.[axis];
    updateObject(objectId, {
      motionParams: {
        ...motionParams,
        [axis]: normalized,
      },
      ...(override?.enabled
        ? {
            motionSpeedControl: {
              ...speedControl,
              overrides: {
                ...(speedControl.overrides ?? {}),
                [axis]: {
                  ...override,
                  speed: normalized.speed,
                },
              },
            },
          }
        : {}),
    });
  };

  const applySpeedControl = (control: MotionSpeedControl) => {
    updateObject(objectId, {
      motionSpeedControl: control,
      motionParams: deriveMotionParamsFromSpeedControl(
        motionParams,
        motionAxes,
        control,
        maxAxisVelocity,
        resolvedMaxByAxis,
      ),
    });
  };

  const handleMaxAxisVelocityChange = (next: number) => {
    updateObject(objectId, {
      maxAxisVelocity: next,
      motionParams: deriveMotionParamsFromSpeedControl(
        motionParams,
        motionAxes,
        speedControl,
        next,
        resolvedMaxByAxis,
      ),
    });
  };

  const applyResolvedMotion = (
    patch: Partial<ControlledObject>,
    nextObject: ControlledObject,
  ) => {
    const resolved = resolveVirtualAxisMaxVelocity(
      {
        id: nextObject.id,
        enabledVirtualAxes: enabledVirtualAxesOf(nextObject.controlType),
        pDefaultMaxVelocity: nextObject.pDefaultMaxVelocity,
        yDefaultMaxVelocity: nextObject.yDefaultMaxVelocity,
      },
      motors,
    );
    updateObject(objectId, {
      ...patch,
      motionParams: clampMotionParamsToAxisMax(
        nextObject.motionParams ?? {},
        motionAxes,
        resolved,
      ),
    });
  };

  const handlePMaxVelocityChange = (next: number) => {
    applyResolvedMotion({ pDefaultMaxVelocity: next }, { ...object, pDefaultMaxVelocity: next });
  };

  const handleYMaxVelocityChange = (next: number) => {
    applyResolvedMotion({ yDefaultMaxVelocity: next }, { ...object, yDefaultMaxVelocity: next });
  };

  const handleSpeedRatioChange = (speedRatio: number) => {
    applySpeedControl({ ...speedControl, speedRatio });
  };

  const handleSpeedOverrideEnabledChange = (axis: MotionAxisKind, enabled: boolean) => {
    const axisParams = motionParams[axis] ?? MOTION_DEFAULTS[axis];
    applySpeedControl({
      ...speedControl,
      overrides: {
        ...(speedControl.overrides ?? {}),
        [axis]: {
          enabled,
          speed: axisParams.speed,
        },
      },
    });
  };

  const speedSummary = (axis: MotionAxisKind, value: MotionAxisParams) => {
    const speedField = MOTION_AXIS_FIELD_DEFINITIONS[axis].find((field) => field.key === "speed");

    return (
      <div className="min-w-0 text-body-sm">
        <span className="text-muted-foreground">自动速度</span>
        <span className="ml-2 font-mono tabular-nums text-foreground">
          {value.speed}
          {speedField?.unit}
        </span>
      </div>
    );
  };

  const externalFileName = modelFileName(object.modelId);
  const rotationAxes = modelRotationAxesForControlType(object.controlType);

  return (
    <div className="min-w-0 space-y-2 p-3">
      <Form
        key={objectId}
        layout="horizontal"
        labelWidth={96}
        className="space-y-2"
        initialValues={object}
        onValuesChange={handleValuesChange}
      >
        <CollapsePanel title="基础信息">
          <div className="space-y-3">
            <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="控制类型">
              <ControlTypeSelector value={object.controlType} onChange={handleControlTypeChange} />
            </Form.Item>
            <Form.Item label="关联主控">
              <p className="truncate pt-2 text-body-sm text-muted-foreground">{boundPlcName}</p>
            </Form.Item>
          </div>
        </CollapsePanel>

        <CollapsePanel title="吊点">
          <ObjectAxesEditor objectId={object.id} controlType={object.controlType} axes={object.axes} />
        </CollapsePanel>

        {motionAxes.length > 0 && (
          <CollapsePanel title="运动参数">
            <div className="space-y-2">
              
              {motionAxes.map((axis) => {
                const axisValue = motionParams[axis] ?? MOTION_DEFAULTS[axis];
                const rangeConfig = AXIS_RANGE_CONFIG[axis];
                const rangeFieldSpec = MOTION_AXIS_FIELD_DEFINITIONS[axis].find(
                  (field) => field.key === rangeConfig.specKey,
                );

                return (
                  <div key={axis} className="space-y-3">
                      {rangeFieldSpec ? (
                        <div className="space-y-1">
                          <span className="text-body-sm text-muted-foreground">{rangeConfig.label}</span>
                          <UnitAwareNumericRangeInput
                            value={{
                              min: axisValue[rangeConfig.minKey],
                              max: axisValue[rangeConfig.maxKey],
                            }}
                            onChange={(range) =>
                              handleMotionAxisChange(axis, {
                                ...axisValue,
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
                      ) : null}
                    </div>
                );
              })}
              <div className="space-y-1">
                <div className="space-y-1">
                  <span className="text-body-sm text-muted-foreground">最大轴速度（比例基准）</span>
                  <UnitAwareNumericInput
                    aria-label="最大轴速度（比例基准）"
                    value={maxAxisVelocity}
                    onChange={handleMaxAxisVelocityChange}
                    min={1}
                    step={1}
                    precision={1}
                    unit="mm/s"
                  />
                </div>
                {enabledVirtualAxesOf(object.controlType).includes("v2") ? (
                  <div className="space-y-1">
                    <span className="text-body-sm text-muted-foreground">
                      {`${getVirtualAxisMeta("v2", object.controlType).label}最大速度`}
                    </span>
                    <UnitAwareNumericInput
                      aria-label={`${getVirtualAxisMeta("v2", object.controlType).label}最大速度`}
                      value={object.pDefaultMaxVelocity ?? DEFAULT_SWING_AXIS_MAX_VELOCITY}
                      onChange={handlePMaxVelocityChange}
                      min={0.1}
                      step={0.1}
                      precision={1}
                      unit={`${getVirtualAxisMeta("v2", object.controlType).unit}/s`}
                    />
                  </div>
                ) : null}
                {enabledVirtualAxesOf(object.controlType).includes("v3") ? (
                  <div className="space-y-1">
                    <span className="text-body-sm text-muted-foreground">
                      {`${getVirtualAxisMeta("v3", object.controlType).label}最大速度`}
                    </span>
                    <UnitAwareNumericInput
                      aria-label={`${getVirtualAxisMeta("v3", object.controlType).label}最大速度`}
                      value={object.yDefaultMaxVelocity ?? DEFAULT_SWING_AXIS_MAX_VELOCITY}
                      onChange={handleYMaxVelocityChange}
                      min={0.1}
                      step={0.1}
                      precision={1}
                      unit={`${getVirtualAxisMeta("v3", object.controlType).unit}/s`}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body-sm text-muted-foreground">速度比例</span>
                    <span className="font-mono text-mono-md tabular-nums text-foreground">
                      {speedControl.speedRatio.toFixed(1)}x
                    </span>
                  </div>
                    <Slider
                    aria-label="速度比例"
                    data-history-interaction="numeric"
                    data-history-field="speedRatio"
                    min={0.2}
                    max={1.5}
                    step={0.1}
                    value={[speedControl.speedRatio]}
                    onValueChange={([next]) => handleSpeedRatioChange(next ?? 1)}
                  />
                  <div className="flex justify-between font-mono text-mono-sm text-muted-foreground">
                    <span>0.2</span>
                    <span>1.0</span>
                    <span>1.5</span>
                  </div>
                </div>
              </div>
              {motionAxes.map((axis) => {
                const axisValue = motionParams[axis] ?? MOTION_DEFAULTS[axis];
                const rangeConfig = AXIS_RANGE_CONFIG[axis];

                return (
                  <CollapsePanel defaultOpen={false} key={axis} title={MOTION_AXIS_LABELS[axis]+"•进阶"}>
                    <div className="space-y-3">
                      <MotionAxisSection
                        axis={axis}
                        value={axisValue}
                        onChange={(value) => handleMotionAxisChange(axis, value)}
                        excludeKeys={[rangeConfig.minKey, rangeConfig.maxKey]}
                        autoSpeed={{
                          enabled: true,
                          summary: speedSummary(axis, axisValue),
                          customEnabled: speedControl.overrides?.[axis]?.enabled ?? false,
                          onCustomEnabledChange: (enabled) =>
                            handleSpeedOverrideEnabledChange(axis, enabled),
                        }}
                      />
                    </div>
                  </CollapsePanel>
                );
              })}
            </div>
          </CollapsePanel>
        )}

        <CollapsePanel title="3D 模型">
          <div className="space-y-3">
            <Form.Item label="模型形状">
              <Select
                options={shapeOptions}
                value={object.shapePreset}
                onChange={(value) => handleShapePresetChange(value as ShapePresetId)}
                aria-label="模型形状"
              />
            </Form.Item>

            {object.shapePreset === "external" ? (
              <Form.Item label="外部模型">
                <div className="flex min-w-0 items-center gap-2 pt-1">
                  <span className="min-w-0 truncate font-mono text-mono-sm text-muted-foreground">
                    {externalFileName || "未选择"}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={openModelLibrary}
                    aria-label="更换外部模型"
                  >
                    更换
                  </Button>
                </div>
              </Form.Item>
            ) : null}

            <Form.Item label="尺寸">
              <ShapeDimensionFields
                shape={object.shapePreset}
                values={shapeDimensions ?? {}}
                onChange={applyShapeDimensions}
              />
            </Form.Item>

            <Form.Item label="坐标">
              <NumericInputGroup>
                {(["x", "y", "z"] as const).map((key) => (
                  <Form.Item key={key} name={["position", key]} noStyle>
                    <UnitAwareNumericInput
                      prefix={key.toUpperCase()}
                      prefixColor={VECTOR_PREFIX_COLORS[key]}
                      unit="mm"
                      step={1}
                      precision={1}
                      aria-label={`位置 ${key.toUpperCase()}`}
                    />
                  </Form.Item>
                ))}
              </NumericInputGroup>
            </Form.Item>

            

            <Form.Item label="旋转">
              <NumericInputGroup>
                {rotationAxes.map((axis) => (
                  <Form.Item key={axis} name={["rotation", axis]} noStyle>
                    <UnitAwareNumericInput
                      prefix={axis.toUpperCase()}
                      prefixColor={VECTOR_PREFIX_COLORS[axis]}
                      unit="°"
                      min={0}
                      max={360}
                      step={1}
                      precision={0}
                      aria-label={`旋转 ${axis.toUpperCase()}`}
                    />
                  </Form.Item>
                ))}
              </NumericInputGroup>
            </Form.Item>

            <Form.Item label="颜色">
              <div className="flex flex-wrap gap-2">
                {OBJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`颜色 ${color}`}
                    onClick={() => updateObject(objectId, { color })}
                    className={cn(
                      "h-8 w-8 rounded-sm border-2 transition-transform hover:scale-105",
                      object.color === color ? "border-primary" : "border-transparent",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </Form.Item>
            <CollapsePanel defaultOpen={false} title="更多">
              <Form.Item label="变换中心">
                <NumericInputGroup>
                  {(["x", "y", "z"] as const).map((axis) => (
                    <UnitAwareNumericInput
                      key={axis}
                      prefix={axis.toUpperCase()}
                      prefixColor={VECTOR_PREFIX_COLORS[axis]}
                      value={object.centerOffset[axis]}
                      onChange={(value) => handleTransformCenterChange(axis, value)}
                      unit="mm"
                      step={1}
                      precision={1}
                      aria-label={`变换中心 ${axis.toUpperCase()}`}
                    />
                  ))}
                </NumericInputGroup>
              </Form.Item>
            </CollapsePanel>
          </div>
        </CollapsePanel>
      </Form>

      <ControlTypeChangeConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setPendingControlType(null);
            setPendingImpact(null);
          }
        }}
        targetLabel={pendingTargetLabel}
        impact={pendingImpact ?? EMPTY_CONTROL_TYPE_CHANGE_IMPACT}
        onConfirm={handleConfirmControlTypeChange}
      />

      <ProjectModelLibraryDialog
        open={modelLibraryOpen}
        onOpenChange={setModelLibraryOpen}
        currentModelId={object.modelId}
        onApply={handleApplyModel}
      />
    </div>
  );
};
