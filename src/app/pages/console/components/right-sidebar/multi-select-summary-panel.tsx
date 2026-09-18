import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CollapsePanel } from "@/app/components/ics/collapse-panel";
import { NumericInputGroup } from "@/app/components/ics/numeric-input-group";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { UnitAwareNumericRangeInput } from "@/app/components/ics/unit-aware-numeric-range-input";
import { Select } from "@/app/components/ui/select";
import { Slider } from "@/app/components/ui/slider";
import { cn } from "@/app/components/ui/utils";
import {
  SCENE_ALIGN_ACTIONS,
  useSceneBuildActions,
} from "@/app/pages/console/3d/use-scene-build-actions";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useProject } from "@/app/project/use-project";
import {
  analyzeControlTypeChangeImpact,
  EMPTY_CONTROL_TYPE_CHANGE_IMPACT,
  type ControlTypeChangeImpact,
} from "@/app/pages/console/hooks/control-type-change";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type {
  ControlType,
  MotionAxisKind,
  MotionAxisParams,
} from "@/app/project/configuration-types";
import {
  deriveMotionParamsFromSpeedControl,
  inferMotionSpeedControl,
} from "@/app/project/motion-speed";
import { normalizeMotionAxisParams } from "@/app/project/motion-acceleration";
import {
  DEFAULT_SWING_AXIS_MAX_VELOCITY,
  clampMotionParamsToAxisMax,
  resolveVirtualAxisMaxVelocity,
} from "@/app/project/virtual-axis-max-velocity";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { getVirtualAxisMeta } from "@/app/pages/console/components/action-builder/virtual-axis-display";
import {
  CONTROL_TYPE_DEFINITION_BY_ID,
  MOTION_AXIS_FIELD_DEFINITIONS,
  MOTION_AXIS_LABELS,
  MOTION_DEFAULTS,
  SHAPE_DEFINITIONS,
  toEngineDimensions,
} from "./config-wizard/config-descriptors";
import { OBJECT_COLORS } from "./config-wizard/config-wizard-constants";
import type { ControlledObject, ShapePresetId } from "./config-wizard/config-wizard-types";
import { ControlTypeSelector } from "./property-forms/control-type-selector";
import { ControlTypeChangeConfirmDialog } from "./property-forms/control-type-change-confirm-dialog";
import { AXIS_RANGE_CONFIG } from "./property-forms/motion-axis-range";
import { MotionAxisSection } from "./property-forms/motion-axis-section";

type MultiSelectSummaryPanelProps = {
  objectIds: number[];
};

const MIXED = Symbol("mixed");

const enabledVirtualAxesOf = (controlType: ControlType): readonly VirtualAxisId[] =>
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType];

const objectHasVirtualAxis = (object: ControlledObject, axis: VirtualAxisId): boolean =>
  enabledVirtualAxesOf(object.controlType).includes(axis);

type SharedValue<T> = T | typeof MIXED;

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a === "number" && typeof b === "number") {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
  }
  return a === b;
};

const getSharedValue = <T,>(values: T[]): SharedValue<T> => {
  if (values.length === 0) return MIXED;
  const first = values[0] as T;
  for (let i = 1; i < values.length; i += 1) {
    if (!valuesEqual(values[i], first)) return MIXED;
  }
  return first;
};

const actionBtn =
  "inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-md border border-border bg-transparent px-3 text-label-caps text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10";

const VECTOR_PREFIX_COLORS = {
  x: "var(--destructive)",
  y: "var(--show)",
  z: "var(--primary)",
} as const;

export const MultiSelectSummaryPanel = ({ objectIds }: MultiSelectSummaryPanelProps) => {
  const { findObject, updateObjectsBatch, changeObjectControlType, motors } = useProjectStore();
  const { currentProject } = useProject();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingControlType, setPendingControlType] = useState<ControlType | null>(null);
  const [pendingImpact, setPendingImpact] = useState<ControlTypeChangeImpact | null>(null);
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const { alignSelection, groupSelection, ungroupSelection } = useSceneBuildActions();

  const selectedObjects = useMemo(
    () =>
      objectIds
        .map((id) => findObject(id))
        .filter((object): object is ControlledObject => Boolean(object)),
    [findObject, objectIds],
  );

  const canMulti = objectIds.length >= 2;
  const canSingle = objectIds.length >= 1;

  /** 控制类型不一致时取运动轴交集；同类型取完整列表 */
  const sharedMotionAxes = useMemo((): MotionAxisKind[] => {
    if (selectedObjects.length === 0) return [];
    let shared = new Set<MotionAxisKind>(
      CONTROL_TYPE_DEFINITION_BY_ID[selectedObjects[0]!.controlType].motionAxes,
    );
    for (const object of selectedObjects.slice(1)) {
      const axes = new Set(CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes);
      shared = new Set([...shared].filter((axis) => axes.has(axis)));
    }
    return [...shared];
  }, [selectedObjects]);

  if (selectedObjects.length < 2) return null;

  const sharedControlType = getSharedValue(selectedObjects.map((object) => object.controlType));
  const sharedShape = getSharedValue(selectedObjects.map((object) => object.shapePreset));
  const sharedColor = getSharedValue(selectedObjects.map((object) => object.color));
  const sharedPosX = getSharedValue(selectedObjects.map((object) => object.position.x));
  const sharedPosY = getSharedValue(selectedObjects.map((object) => object.position.y));
  const sharedPosZ = getSharedValue(selectedObjects.map((object) => object.position.z));

  const sharedMaxAxisVelocity =
    sharedMotionAxes.length > 0
      ? getSharedValue(selectedObjects.map((object) => object.maxAxisVelocity))
      : null;

  const sharedSpeedRatio =
    sharedMotionAxes.length > 0
      ? getSharedValue(
          selectedObjects.map((object) => {
            const control =
              object.motionSpeedControl ??
              inferMotionSpeedControl(object.motionParams ?? {}, object.maxAxisVelocity);
            return control.speedRatio;
          }),
        )
      : null;

  const showPMax =
    selectedObjects.length > 0 &&
    selectedObjects.every((object) => objectHasVirtualAxis(object, "v2"));
  const showYMax =
    selectedObjects.length > 0 &&
    selectedObjects.every((object) => objectHasVirtualAxis(object, "v3"));
  const sharedPMax = showPMax
    ? getSharedValue(
        selectedObjects.map(
          (object) => object.pDefaultMaxVelocity ?? DEFAULT_SWING_AXIS_MAX_VELOCITY,
        ),
      )
    : null;
  const sharedYMax = showYMax
    ? getSharedValue(
        selectedObjects.map(
          (object) => object.yDefaultMaxVelocity ?? DEFAULT_SWING_AXIS_MAX_VELOCITY,
        ),
      )
    : null;
  const v2Meta = getVirtualAxisMeta(
    "v2",
    sharedControlType === MIXED ? selectedObjects[0]?.controlType : sharedControlType,
  );
  const v3Meta = getVirtualAxisMeta(
    "v3",
    sharedControlType === MIXED ? selectedObjects[0]?.controlType : sharedControlType,
  );

  const readAxisParams = (object: ControlledObject, axis: MotionAxisKind): MotionAxisParams =>
    object.motionParams?.[axis] ?? MOTION_DEFAULTS[axis];

  const getSharedAxisField = (
    axis: MotionAxisKind,
    key: keyof MotionAxisParams,
  ): SharedValue<number> =>
    getSharedValue(selectedObjects.map((object) => readAxisParams(object, axis)[key]));

  const getAxisMixedKeys = (axis: MotionAxisKind): Set<keyof MotionAxisParams> => {
    const mixed = new Set<keyof MotionAxisParams>();
    for (const field of MOTION_AXIS_FIELD_DEFINITIONS[axis]) {
      if (getSharedAxisField(axis, field.key) === MIXED) mixed.add(field.key);
    }
    return mixed;
  };

  const getAxisDisplayParams = (axis: MotionAxisKind): MotionAxisParams => {
    const base = { ...MOTION_DEFAULTS[axis] };
    for (const field of MOTION_AXIS_FIELD_DEFINITIONS[axis]) {
      const shared = getSharedAxisField(axis, field.key);
      if (shared !== MIXED) base[field.key] = shared;
    }
    return base;
  };

  const shapeOptions = SHAPE_DEFINITIONS.filter((shape) => shape.id !== "external").map(
    (shape) => ({
      label: shape.label,
      value: shape.id,
    }),
  );

  const shapeDefinition =
    sharedShape === MIXED
      ? null
      : (SHAPE_DEFINITIONS.find((shape) => shape.id === sharedShape) ?? null);

  const patchAll = (buildPatch: (object: ControlledObject) => Partial<ControlledObject>) => {
    updateObjectsBatch(
      selectedObjects.map((object) => ({
        id: object.id,
        patch: buildPatch(object),
      })),
    );
  };

  const handleControlTypeChange = (controlType: ControlType) => {
    const document = currentProject?.document;
    if (!document) return;
    const ids = selectedObjects.map((object) => object.id);
    const impact = analyzeControlTypeChangeImpact(document, ids, controlType);
    if (!impact.changed) {
      changeObjectControlType(ids, controlType);
      return;
    }
    setPendingControlType(controlType);
    setPendingImpact(impact);
    setPendingIds(ids);
    setConfirmOpen(true);
  };

  const handleConfirmControlTypeChange = () => {
    if (pendingControlType) {
      const result = changeObjectControlType(pendingIds, pendingControlType);
      if (!result.ok) toast.error(result.reason);
    }
    setPendingControlType(null);
    setPendingImpact(null);
    setPendingIds([]);
    setConfirmOpen(false);
  };

  const pendingTargetLabel = pendingControlType
    ? CONTROL_TYPE_DEFINITION_BY_ID[pendingControlType].label
    : "";

  const handleShapePresetChange = (shapePreset: ShapePresetId) => {
    const definition = SHAPE_DEFINITIONS.find((shape) => shape.id === shapePreset);
    if (!definition) return;
    const nextDimensions = Object.fromEntries(
      definition.fields.map((field) => [field.key, field.defaultValue]),
    ) as ControlledObject["shapeDimensions"];

    patchAll(() => ({
      shapePreset,
      shapeDimensions: nextDimensions,
      dimensions: toEngineDimensions(shapePreset, nextDimensions!),
    }));
  };

  const handleDimensionChange = (key: string, value: number) => {
    if (sharedShape === MIXED) return;
    patchAll((object) => {
      const nextDimensions = {
        ...(object.shapeDimensions ?? {}),
        [key]: value,
      } as ControlledObject["shapeDimensions"];
      return {
        shapeDimensions: nextDimensions,
        dimensions: toEngineDimensions(object.shapePreset, nextDimensions),
      };
    });
  };

  const handlePositionChange = (axis: "x" | "y" | "z", value: number) => {
    patchAll((object) => ({
      position: { ...object.position, [axis]: value },
    }));
  };

  const resolvedMaxForObject = (object: ControlledObject) =>
    resolveVirtualAxisMaxVelocity(
      {
        id: object.id,
        enabledVirtualAxes: ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType],
        pDefaultMaxVelocity: object.pDefaultMaxVelocity,
        yDefaultMaxVelocity: object.yDefaultMaxVelocity,
      },
      motors,
    );

  const handleMaxAxisVelocityChange = (next: number) => {
    if (sharedMotionAxes.length === 0) return;
    patchAll((object) => {
      const motionParams = object.motionParams ?? {};
      const objectAxes = CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes;
      const speedControl =
        object.motionSpeedControl ??
        inferMotionSpeedControl(motionParams, object.maxAxisVelocity);
      return {
        maxAxisVelocity: next,
        motionParams: deriveMotionParamsFromSpeedControl(
          motionParams,
          [...objectAxes] as MotionAxisKind[],
          speedControl,
          next,
          resolvedMaxForObject(object),
        ),
      };
    });
  };

  const handlePMaxVelocityChange = (next: number) => {
    patchAll((object) => {
      if (!objectHasVirtualAxis(object, "v2")) return {};
      const nextObject = { ...object, pDefaultMaxVelocity: next };
      return {
        pDefaultMaxVelocity: next,
        motionParams: clampMotionParamsToAxisMax(
          object.motionParams ?? {},
          CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes,
          resolvedMaxForObject(nextObject),
        ),
      };
    });
  };

  const handleYMaxVelocityChange = (next: number) => {
    patchAll((object) => {
      if (!objectHasVirtualAxis(object, "v3")) return {};
      const nextObject = { ...object, yDefaultMaxVelocity: next };
      return {
        yDefaultMaxVelocity: next,
        motionParams: clampMotionParamsToAxisMax(
          object.motionParams ?? {},
          CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes,
          resolvedMaxForObject(nextObject),
        ),
      };
    });
  };

  const handleSpeedRatioChange = (speedRatio: number) => {
    if (sharedMotionAxes.length === 0) return;
    patchAll((object) => {
      const motionParams = object.motionParams ?? {};
      const objectAxes = CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes;
      const speedControl =
        object.motionSpeedControl ??
        inferMotionSpeedControl(motionParams, object.maxAxisVelocity);
      const nextControl = { ...speedControl, speedRatio };
      return {
        motionSpeedControl: nextControl,
        motionParams: deriveMotionParamsFromSpeedControl(
          motionParams,
          [...objectAxes] as MotionAxisKind[],
          nextControl,
          object.maxAxisVelocity,
          resolvedMaxForObject(object),
        ),
      };
    });
  };

  const handleMotionFieldChange = (
    axis: MotionAxisKind,
    key: keyof MotionAxisParams,
    next: number,
  ) => {
    patchAll((object) => {
      const motionParams = object.motionParams ?? {};
      const current = readAxisParams(object, axis);
      const nextAxis = normalizeMotionAxisParams({ ...current, [key]: next });
      const speedControl =
        object.motionSpeedControl ??
        inferMotionSpeedControl(motionParams, object.maxAxisVelocity);
      const override = speedControl.overrides?.[axis];
      return {
        motionParams: {
          ...motionParams,
          [axis]: nextAxis,
        },
        ...(override?.enabled && key === "speed"
          ? {
              motionSpeedControl: {
                ...speedControl,
                overrides: {
                  ...(speedControl.overrides ?? {}),
                  [axis]: {
                    ...override,
                    speed: next,
                  },
                },
              },
            }
          : {}),
      };
    });
  };

  const handleMotionRangeChange = (
    axis: MotionAxisKind,
    range: { min: number; max: number },
  ) => {
    const rangeConfig = AXIS_RANGE_CONFIG[axis];
    patchAll((object) => {
      const motionParams = object.motionParams ?? {};
      const current = readAxisParams(object, axis);
      return {
        motionParams: {
          ...motionParams,
          [axis]: normalizeMotionAxisParams({
            ...current,
            [rangeConfig.minKey]: range.min,
            [rangeConfig.maxKey]: range.max,
          }),
        },
      };
    });
  };

  const handleSpeedOverrideEnabledChange = (axis: MotionAxisKind, enabled: boolean) => {
    patchAll((object) => {
      const motionParams = object.motionParams ?? {};
      const objectAxes: MotionAxisKind[] = [
        ...CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].motionAxes,
      ];
      if (!objectAxes.some((item) => item === axis)) return {};
      const speedControl =
        object.motionSpeedControl ??
        inferMotionSpeedControl(motionParams, object.maxAxisVelocity);
      const axisParams = readAxisParams(object, axis);
      const nextControl = {
        ...speedControl,
        overrides: {
          ...(speedControl.overrides ?? {}),
          [axis]: {
            enabled,
            speed: axisParams.speed,
          },
        },
      };
      return {
        motionSpeedControl: nextControl,
        motionParams: deriveMotionParamsFromSpeedControl(
          motionParams,
          objectAxes,
          nextControl,
          object.maxAxisVelocity,
          resolvedMaxForObject(object),
        ),
      };
    });
  };

  const speedSummary = (axis: MotionAxisKind, value: MotionAxisParams) => {
    const speedField = MOTION_AXIS_FIELD_DEFINITIONS[axis].find((field) => field.key === "speed");
    const speedMixed = getSharedAxisField(axis, "speed") === MIXED;
    return (
      <div className="min-w-0 text-body-sm">
        <span className="text-muted-foreground">自动速度</span>
        <span className="ml-2 font-mono tabular-nums text-foreground">
          {speedMixed ? "--" : value.speed}
          {speedField?.unit}
        </span>
      </div>
    );
  };

  const readDimension = (object: ControlledObject, key: string, fallback: number): number => {
    const fromShape = (
      object.shapeDimensions as Record<string, number | undefined> | undefined
    )?.[key];
    if (typeof fromShape === "number" && Number.isFinite(fromShape)) return fromShape;
    return fallback;
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-label-caps text-muted-foreground">已选 {objectIds.length} 个受控物体</p>

      <div className="flex flex-col gap-3">
        <section className="rounded-md bg-muted p-3" aria-label="对齐">
          <p className="mb-2 text-label-caps text-muted-foreground">对齐</p>
          <div className="flex flex-wrap gap-2">
            {SCENE_ALIGN_ACTIONS.map(({ mode, label, colorClass, hoverClass, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                disabled={!canMulti}
                className={cn(actionBtn, "min-w-10 px-2", hoverClass)}
                aria-label={label}
                title={label}
                onClick={() => alignSelection(mode)}
              >
                <Icon className={cn("h-4 w-4", colorClass)} aria-hidden />
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap gap-2" aria-label="组合">
          <button type="button" disabled={!canMulti} className={actionBtn} onClick={groupSelection}>
            组合
          </button>
          <button
            type="button"
            disabled={!canSingle}
            className={actionBtn}
            onClick={ungroupSelection}
          >
            解组
          </button>
        </section>
      </div>

      <CollapsePanel title="批量属性" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-label-caps text-muted-foreground">基础</p>
            <div className="flex min-h-9 items-center gap-3">
              <span className="w-24 shrink-0 text-body-sm text-muted-foreground">控制类型</span>
              <div className="min-w-0 flex-1">
                <ControlTypeSelector
                  value={sharedControlType === MIXED ? undefined : sharedControlType}
                  onChange={handleControlTypeChange}
                />
              </div>
            </div>
            {sharedControlType === MIXED ? (
              <p className="text-body-sm text-muted-foreground">不一致时选择后将统一更新</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-label-caps text-muted-foreground">3D 模型</p>
            <div className="flex min-h-9 items-center gap-3">
              <span className="w-24 shrink-0 text-body-sm text-muted-foreground">模型形状</span>
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="模型形状"
                  placeholder="--"
                  value={sharedShape === MIXED ? undefined : sharedShape}
                  onValueChange={(next) => handleShapePresetChange(next as ShapePresetId)}
                  options={shapeOptions}
                />
              </div>
            </div>

            {shapeDefinition ? (
              <div className="space-y-1">
                <span className="text-body-sm text-muted-foreground">尺寸</span>
                <NumericInputGroup>
                  {shapeDefinition.fields.map((field) => {
                    const shared = getSharedValue(
                      selectedObjects.map((object) =>
                        readDimension(object, field.key, field.defaultValue),
                      ),
                    );
                    const mixed = shared === MIXED;
                    return (
                      <UnitAwareNumericInput
                        key={field.key}
                        prefix={field.label}
                        aria-label={field.label}
                        mixed={mixed}
                        value={mixed ? 0 : (shared as number)}
                        onChange={(next) => handleDimensionChange(field.key, next)}
                        onCommit={(next) => handleDimensionChange(field.key, next)}
                        unit={field.unit}
                        step={1}
                        precision={1}
                      />
                    );
                  })}
                </NumericInputGroup>
              </div>
            ) : sharedShape === MIXED ? (
              <p className="text-body-sm text-muted-foreground">形状不一致，无法批量改尺寸</p>
            ) : null}

            <div className="space-y-1">
              <span className="text-body-sm text-muted-foreground">坐标</span>
              <NumericInputGroup>
                {(
                  [
                    ["x", sharedPosX],
                    ["y", sharedPosY],
                    ["z", sharedPosZ],
                  ] as const
                ).map(([axis, shared]) => {
                  const mixed = shared === MIXED;
                  return (
                    <UnitAwareNumericInput
                      key={axis}
                      prefix={axis.toUpperCase()}
                      prefixColor={VECTOR_PREFIX_COLORS[axis]}
                      aria-label={`位置 ${axis.toUpperCase()}`}
                      mixed={mixed}
                      value={mixed ? 0 : (shared as number)}
                      onChange={(next) => handlePositionChange(axis, next)}
                      onCommit={(next) => handlePositionChange(axis, next)}
                      unit="mm"
                      step={1}
                      precision={1}
                    />
                  );
                })}
              </NumericInputGroup>
            </div>

            <div className="space-y-1">
              <span className="text-body-sm text-muted-foreground">颜色</span>
              <div className="flex flex-wrap gap-2">
                {OBJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`颜色 ${color}`}
                    onClick={() => patchAll(() => ({ color }))}
                    className={cn(
                      "h-8 w-8 rounded-sm border-2 transition-transform hover:scale-105",
                      sharedColor !== MIXED && sharedColor === color
                        ? "border-primary"
                        : "border-transparent",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          {sharedMotionAxes.length > 0 ? (
            <div className="space-y-3">
              <p className="text-label-caps text-muted-foreground">运动参数</p>
              {sharedControlType === MIXED ? (
                <p className="text-body-sm text-muted-foreground">
                  控制类型不一致，仅显示共有运动轴参数
                </p>
              ) : null}

              {sharedMotionAxes.map((axis) => {
                const rangeConfig = AXIS_RANGE_CONFIG[axis];
                const rangeFieldSpec = MOTION_AXIS_FIELD_DEFINITIONS[axis].find(
                  (field) => field.key === rangeConfig.specKey,
                );
                const minShared = getSharedAxisField(axis, rangeConfig.minKey);
                const maxShared = getSharedAxisField(axis, rangeConfig.maxKey);
                const display = getAxisDisplayParams(axis);
                return (
                  <div key={`range-${axis}`} className="space-y-1">
                    <span className="text-body-sm text-muted-foreground">
                      {sharedMotionAxes.length > 1
                        ? `${MOTION_AXIS_LABELS[axis]} · ${rangeConfig.label}`
                        : rangeConfig.label}
                    </span>
                    {rangeFieldSpec ? (
                      <UnitAwareNumericRangeInput
                        value={{
                          min: minShared === MIXED ? display[rangeConfig.minKey] : minShared,
                          max: maxShared === MIXED ? display[rangeConfig.maxKey] : maxShared,
                        }}
                        minMixed={minShared === MIXED}
                        maxMixed={maxShared === MIXED}
                        onChange={(range) => handleMotionRangeChange(axis, range)}
                        onCommit={(range) => handleMotionRangeChange(axis, range)}
                        unit={rangeFieldSpec.unit}
                        step={rangeFieldSpec.step ?? 1}
                        precision={rangeFieldSpec.precision ?? 1}
                        minAriaLabel={rangeConfig.minAriaLabel}
                        maxAriaLabel={rangeConfig.maxAriaLabel}
                      />
                    ) : null}
                  </div>
                );
              })}

              <div className="space-y-1">
                <span className="text-body-sm text-muted-foreground">最大轴速度（比例基准）</span>
                <UnitAwareNumericInput
                  aria-label="最大轴速度（比例基准）"
                  mixed={sharedMaxAxisVelocity === MIXED}
                  value={sharedMaxAxisVelocity === MIXED ? 0 : (sharedMaxAxisVelocity ?? 0)}
                  onChange={handleMaxAxisVelocityChange}
                  onCommit={handleMaxAxisVelocityChange}
                  unit="mm/s"
                  min={1}
                  step={1}
                  precision={1}
                />
              </div>
              {showPMax ? (
                <div className="space-y-1">
                  <span className="text-body-sm text-muted-foreground">
                    {`${v2Meta.label}最大速度`}
                  </span>
                  <UnitAwareNumericInput
                    aria-label={`${v2Meta.label}最大速度`}
                    mixed={sharedPMax === MIXED}
                    value={sharedPMax === MIXED ? 0 : (sharedPMax ?? 0)}
                    onChange={handlePMaxVelocityChange}
                    onCommit={handlePMaxVelocityChange}
                    unit={`${v2Meta.unit}/s`}
                    min={0.1}
                    step={0.1}
                    precision={1}
                  />
                </div>
              ) : null}
              {showYMax ? (
                <div className="space-y-1">
                  <span className="text-body-sm text-muted-foreground">
                    {`${v3Meta.label}最大速度`}
                  </span>
                  <UnitAwareNumericInput
                    aria-label={`${v3Meta.label}最大速度`}
                    mixed={sharedYMax === MIXED}
                    value={sharedYMax === MIXED ? 0 : (sharedYMax ?? 0)}
                    onChange={handleYMaxVelocityChange}
                    onCommit={handleYMaxVelocityChange}
                    unit={`${v3Meta.unit}/s`}
                    min={0.1}
                    step={0.1}
                    precision={1}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body-sm text-muted-foreground">速度比例</span>
                  <span className="font-mono text-mono-md tabular-nums text-foreground">
                    {sharedSpeedRatio === MIXED
                      ? "--"
                      : `${(sharedSpeedRatio ?? 1).toFixed(1)}x`}
                  </span>
                </div>
                <Slider
                  aria-label="速度比例"
                  data-history-interaction="numeric"
                  data-history-field="speedRatio"
                  min={0.2}
                  max={1.5}
                  step={0.1}
                  value={[sharedSpeedRatio === MIXED ? 1 : (sharedSpeedRatio ?? 1)]}
                  onValueChange={([next]) => handleSpeedRatioChange(next ?? 1)}
                />
                <div className="flex justify-between font-mono text-mono-sm text-muted-foreground">
                  <span>0.2</span>
                  <span>1.0</span>
                  <span>1.5</span>
                </div>
              </div>

              {sharedMotionAxes.map((axis) => {
                const rangeConfig = AXIS_RANGE_CONFIG[axis];
                const display = getAxisDisplayParams(axis);
                const mixedKeys = getAxisMixedKeys(axis);
                const customEnabledShared = getSharedValue(
                  selectedObjects.map((object) => {
                    const control =
                      object.motionSpeedControl ??
                      inferMotionSpeedControl(
                        object.motionParams ?? {},
                        object.maxAxisVelocity,
                      );
                    return control.overrides?.[axis]?.enabled ?? false;
                  }),
                );
                return (
                  <CollapsePanel
                    key={`axis-${axis}`}
                    defaultOpen={false}
                    title={MOTION_AXIS_LABELS[axis]}
                  >
                    <MotionAxisSection
                      axis={axis}
                      value={display}
                      onChange={() => undefined}
                      onFieldChange={(key, next) => handleMotionFieldChange(axis, key, next)}
                      excludeKeys={[rangeConfig.minKey, rangeConfig.maxKey]}
                      mixedKeys={mixedKeys}
                      autoSpeed={{
                        enabled: true,
                        summary: speedSummary(axis, display),
                        customEnabled:
                          customEnabledShared === MIXED
                            ? false
                            : Boolean(customEnabledShared),
                        customEnabledMixed: customEnabledShared === MIXED,
                        onCustomEnabledChange: (enabled) =>
                          handleSpeedOverrideEnabledChange(axis, enabled),
                      }}
                    />
                  </CollapsePanel>
                );
              })}
            </div>
          ) : null}
        </div>
      </CollapsePanel>

      <ControlTypeChangeConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setPendingControlType(null);
            setPendingImpact(null);
            setPendingIds([]);
          }
        }}
        targetLabel={pendingTargetLabel}
        impact={pendingImpact ?? EMPTY_CONTROL_TYPE_CHANGE_IMPACT}
        onConfirm={handleConfirmControlTypeChange}
      />
    </div>
  );
};
