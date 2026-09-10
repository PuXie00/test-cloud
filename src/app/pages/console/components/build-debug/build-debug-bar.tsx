import { useEffect, useState } from "react";
import type { DisplayOperation, OperationField } from "@shared/config";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Input } from "@/app/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { Select } from "@/app/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/app/components/ui/toggle-group";
import { cn } from "@/app/components/ui/utils";
import { preloadMotorModelConfigs } from "@/app/pages/console/hooks/motor-config";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  getDisplayLengthFamilyUnit,
  isLengthFamilyUnit,
  normalizeLengthFamilyUnit,
  toCanonicalLengthValue,
  toDisplayLengthValue,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import {
  confirmIfNeeded,
  defaultParamValues,
  executeDynamicOperation,
  operationHasParams,
  variableOperationsForModel,
} from "./build-debug-dynamic-ops";
import {
  debugAccelDisplayUnit,
  debugPositionDisplayUnit,
  debugSpeedDisplayUnit,
  formatRelativeQuickLabel,
  relativeMoveQuickDeltas,
  toDebugCanonicalValue,
  toDebugDisplayValue,
} from "./build-debug-display";
import {
  applyClear731AlarmMotor,
  applyCommTestMotor,
  applyDebugMotionParams,
  applyEnableMotor,
  applyJogMotor,
  applyMoveAbsMotor,
  applyResetAlarmMotor,
  applySetPositionMotor,
  applyStopMotor,
  fetchAllDebugMotionParams,
  mergeDebugMotionParams,
  MIXED_DEBUG_PARAM,
  relativeMoveTargetMm,
  roundToTenthMm,
} from "./build-debug-native";
import { useBuildDebug } from "./build-debug-context";
import {
  DEFAULT_DEBUG_MOTION_PARAMS,
  type DebugMotionParams,
} from "./build-debug-types";
import { JogButton } from "./jog-button";

type BuildDebugBarProps = {
  className?: string;
};

const barBtnClass =
  "inline-flex h-10 items-center rounded-md border border-border px-2.5 text-body-sm text-foreground hover:bg-accent disabled:opacity-40 [@media(pointer:coarse)]:h-11";

/** 无参：直接执行 */
const directOpBtnClass =
  "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-md bg-primary px-2.5 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 [@media(pointer:coarse)]:h-11";

/** 有参：二级表单入口 */
const formOpBtnClass =
  "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-primary/50 bg-transparent px-2.5 text-body-sm text-primary hover:bg-primary/10 disabled:opacity-40 [@media(pointer:coarse)]:h-11";

const dangerBtnClass =
  "inline-flex h-10 items-center rounded-md bg-destructive px-2.5 text-body-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 [@media(pointer:coarse)]:h-11";

type ParamsPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  motorLabel: string;
  defaultVelocity: string;
  defaultAcceleration: string;
  defaultDeceleration: string;
  maximumStroke: string;
  speedUnit: string;
  accelUnit: string;
  strokeUnit: string;
  displayStep: number;
  positionStep: number;
  applying: boolean;
  loading: boolean;
  onDefaultVelocityChange: (value: string) => void;
  onDefaultAccelerationChange: (value: string) => void;
  onDefaultDecelerationChange: (value: string) => void;
  onMaximumStrokeChange: (value: string) => void;
  onCancel: () => void;
  onApply: () => void;
};

const mixedInputValue = (raw: string) => (raw === MIXED_DEBUG_PARAM ? "" : raw);
const mixedInputPlaceholder = (raw: string) =>
  raw === MIXED_DEBUG_PARAM ? MIXED_DEBUG_PARAM : undefined;

const MotionParamsPopover = ({
  open,
  onOpenChange,
  disabled,
  motorLabel,
  defaultVelocity,
  defaultAcceleration,
  defaultDeceleration,
  maximumStroke,
  speedUnit,
  accelUnit,
  strokeUnit,
  displayStep,
  positionStep,
  applying,
  loading,
  onDefaultVelocityChange,
  onDefaultAccelerationChange,
  onDefaultDecelerationChange,
  onMaximumStrokeChange,
  onCancel,
  onApply,
}: ParamsPopoverProps) => (
  <Popover
    modal={false}
    open={open}
    onOpenChange={(next) => {
      if (!next) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        requestAnimationFrame(() => onOpenChange(false));
        return;
      }
      onOpenChange(true);
    }}
  >
    <PopoverTrigger asChild>
      <button
        type="button"
        disabled={disabled}
        aria-label="设置调试参数"
        className={cn(barBtnClass, "gap-1.5")}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        设置参数
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
      }}
      className="w-72 border-border/60 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      <div className="bg-muted px-3 py-2">
        <p className="text-label-caps text-muted-foreground">调试参数</p>
        <p className="mt-0.5 font-mono text-mono-sm tabular-nums text-foreground">{motorLabel}</p>
      </div>
      <div className="space-y-3 bg-background p-3">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-muted-foreground">默认运行速度 ({speedUnit})</span>
          <Input
            type="number"
            showStepper
            min={0}
            step={displayStep}
            value={mixedInputValue(defaultVelocity)}
            placeholder={mixedInputPlaceholder(defaultVelocity)}
            disabled={applying || loading}
            aria-label={`默认运行速度 ${speedUnit}`}
            onChange={(event) => onDefaultVelocityChange(event.target.value)}
            className="text-right font-mono text-mono-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-muted-foreground">默认加速度 ({accelUnit})</span>
          <Input
            type="number"
            showStepper
            min={0}
            step={displayStep}
            value={mixedInputValue(defaultAcceleration)}
            placeholder={mixedInputPlaceholder(defaultAcceleration)}
            disabled={applying || loading}
            aria-label={`默认加速度 ${accelUnit}`}
            onChange={(event) => onDefaultAccelerationChange(event.target.value)}
            className="text-right font-mono text-mono-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-muted-foreground">默认减速度 ({accelUnit})</span>
          <Input
            type="number"
            showStepper
            min={0}
            step={displayStep}
            value={mixedInputValue(defaultDeceleration)}
            placeholder={mixedInputPlaceholder(defaultDeceleration)}
            disabled={applying || loading}
            aria-label={`默认减速度 ${accelUnit}`}
            onChange={(event) => onDefaultDecelerationChange(event.target.value)}
            className="text-right font-mono text-mono-sm tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-muted-foreground">最大运行行程 ({strokeUnit})</span>
          <Input
            type="number"
            showStepper
            min={0}
            step={positionStep}
            value={mixedInputValue(maximumStroke)}
            placeholder={mixedInputPlaceholder(maximumStroke)}
            disabled={applying || loading}
            aria-label={`最大运行行程 ${strokeUnit}`}
            onChange={(event) => onMaximumStrokeChange(event.target.value)}
            className="text-right font-mono text-mono-sm tabular-nums"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 bg-muted px-3 py-2">
        <button
          type="button"
          disabled={applying || loading}
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="button"
          disabled={applying || loading}
          onClick={onApply}
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          执行
        </button>
      </div>
    </PopoverContent>
  </Popover>
);

const fieldLabel = (field: OperationField, displayUnit: DisplayLengthUnit): string => {
  const unit = field.unit?.trim();
  if (!unit) return field.label;
  const normalized = normalizeLengthFamilyUnit(unit);
  if (isLengthFamilyUnit(normalized)) {
    return `${field.label} (${getDisplayLengthFamilyUnit(normalized, displayUnit)})`;
  }
  return `${field.label} (${normalized})`;
};

const runDynamicOp = async (
  op: DisplayOperation,
  mid: number,
  values: Record<string, string> = {},
): Promise<boolean> => {
  if (!(await confirmIfNeeded(op))) return false;
  const result = await executeDynamicOperation(op, mid, values);
  return result.ok;
};

type DynamicOpButtonProps = {
  operation: DisplayOperation;
  disabled: boolean;
  motorLabel: string;
  mid: number;
};

/** 无参：条上直接点执行 */
const DirectDynamicOpButton = ({ operation, disabled, mid }: DynamicOpButtonProps) => {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runDynamicOp(operation, mid);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label={operation.label}
      title={operation.label}
      onClick={() => void handleClick()}
      className={directOpBtnClass}
    >
      {operation.label}
    </button>
  );
};

const toDisplayOpDefaults = (
  fields: OperationField[],
  display: DisplayLengthUnit,
): Record<string, string> => {
  const defaults = defaultParamValues(fields);
  const next: Record<string, string> = { ...defaults };
  for (const field of fields) {
    if (field.dataType === "enum") continue;
    const unit = field.unit?.trim();
    if (!unit || !isLengthFamilyUnit(unit)) continue;
    const canonical = parseFloat(defaults[field.id] ?? "0");
    if (!Number.isFinite(canonical)) continue;
    next[field.id] = String(toDisplayLengthValue(canonical, display));
  }
  return next;
};

const toCanonicalOpValues = (
  fields: OperationField[],
  displayValues: Record<string, string>,
  display: DisplayLengthUnit,
): Record<string, string> => {
  const next: Record<string, string> = { ...displayValues };
  for (const field of fields) {
    if (field.dataType === "enum") continue;
    const unit = field.unit?.trim();
    if (!unit || !isLengthFamilyUnit(unit)) continue;
    const shown = parseFloat(displayValues[field.id] ?? "0");
    if (!Number.isFinite(shown)) continue;
    next[field.id] = String(toCanonicalLengthValue(shown, display));
  }
  return next;
};

/** 有参：二级 Popover 填参后执行 */
const FormDynamicOpButton = ({
  operation,
  disabled,
  motorLabel,
  mid,
}: DynamicOpButtonProps) => {
  const display = useSessionDisplayLengthUnit();
  const displayStep = toDisplayLengthValue(1, display);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    toDisplayOpDefaults(operation.param, display),
  );

  const close = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => setOpen(false));
  };

  useEffect(() => {
    if (!open) return;
    setValues(toDisplayOpDefaults(operation.param, display));
  }, [open, operation, display]);

  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);

  const handleExecute = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canonicalValues = toCanonicalOpValues(operation.param, values, display);
      const ok = await runDynamicOp(operation, mid, canonicalValues);
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
          return;
        }
        setOpen(true);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${operation.label}（需参数）`}
          title={`${operation.label} · 需填写参数`}
          className={formOpBtnClass}
        >
          <span className="truncate">{operation.label}</span>
          <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className="w-64 border-border/60 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      >
        <div className="bg-muted px-3 py-2">
          <p className="text-label-caps text-muted-foreground">{operation.label}</p>
          <p className="mt-0.5 font-mono text-mono-sm tabular-nums text-foreground">{motorLabel}</p>
        </div>
        <div className="space-y-3 bg-background p-3">
          {operation.param.map((field) => {
            const label = fieldLabel(field, display);
            const lengthFamily = isLengthFamilyUnit(field.unit);
            if (field.dataType === "enum") {
              const options = (field.values ?? []).map(([value, text]) => ({
                label: text,
                value: String(value),
              }));
              return (
                <label key={field.id} className="flex flex-col gap-1">
                  <span className="text-body-sm text-muted-foreground">{label}</span>
                  <Select
                    value={values[field.id] ?? ""}
                    options={options}
                    aria-label={label}
                    disabled={busy}
                    onValueChange={(next) =>
                      setValues((prev) => ({ ...prev, [field.id]: next }))
                    }
                  />
                </label>
              );
            }
            return (
              <label key={field.id} className="flex flex-col gap-1">
                <span className="text-body-sm text-muted-foreground">{label}</span>
                <Input
                  type="number"
                  showStepper
                  min={
                    lengthFamily && field.min != null
                      ? toDisplayLengthValue(field.min, display)
                      : field.min
                  }
                  max={
                    lengthFamily && field.max != null
                      ? toDisplayLengthValue(field.max, display)
                      : field.max
                  }
                  step={lengthFamily ? displayStep : 1}
                  value={values[field.id] ?? "0"}
                  disabled={busy}
                  aria-label={label}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
                  }
                  className="text-right font-mono text-mono-sm tabular-nums"
                />
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 bg-muted px-3 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleExecute()}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            执行
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const DynamicOpSlot = (props: DynamicOpButtonProps) =>
  operationHasParams(props.operation) ? (
    <FormDynamicOpButton {...props} />
  ) : (
    <DirectDynamicOpButton {...props} />
  );

/** 调试控制条：挂在调试 tab 底部 */
export const BuildDebugBar = ({ className }: BuildDebugBarProps) => {
  const display = useSessionDisplayLengthUnit();
  const speedUnit = debugSpeedDisplayUnit(display);
  const accelUnit = debugAccelDisplayUnit(display);
  const positionUnit = debugPositionDisplayUnit(display);
  const displayStep = toDebugDisplayValue(1, display);
  const positionStep = toDebugDisplayValue(0.1, display);
  const formatMotionDisplay = (canonical: number) => String(toDebugDisplayValue(canonical, display));
  const { findMotor, motors } = useProjectStore();
  const {
    primaryMotorId,
    selectedMotorIds,
    stop,
    isMotorOnline,
    displayPositionOf,
  } = useBuildDebug();

  const [expanded, setExpanded] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<"absolute" | "relative">("absolute");
  const [targetValue, setTargetValue] = useState("0");
  const [limitRange, setLimitRange] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [setPositionOpen, setSetPositionOpen] = useState(false);
  const [setPositionValue, setSetPositionValue] = useState("0");
  const [setPositionApplying, setSetPositionApplying] = useState(false);
  const [defaultVelocity, setDefaultVelocity] = useState(() =>
    formatMotionDisplay(DEFAULT_DEBUG_MOTION_PARAMS.defaultVelocity),
  );
  const [defaultAcceleration, setDefaultAcceleration] = useState(() =>
    formatMotionDisplay(DEFAULT_DEBUG_MOTION_PARAMS.defaultAcceleration),
  );
  const [defaultDeceleration, setDefaultDeceleration] = useState(() =>
    formatMotionDisplay(DEFAULT_DEBUG_MOTION_PARAMS.defaultDeceleration),
  );
  const [maximumStroke, setMaximumStroke] = useState(() =>
    formatMotionDisplay(DEFAULT_DEBUG_MOTION_PARAMS.maximumStroke),
  );
  const [paramsApplying, setParamsApplying] = useState(false);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [allMotionParams, setAllMotionParams] = useState<Map<number, DebugMotionParams>>(
    () => new Map(),
  );

  const primaryOnline = primaryMotorId ? isMotorOnline(primaryMotorId) : false;
  const primaryMotor = primaryMotorId ? findMotor(primaryMotorId) : undefined;
  const motorLabel = primaryMotor ? formatMotorDisplayName(motors, primaryMotor) : "—";
  const batchIds = [...selectedMotorIds].filter((id) => isMotorOnline(id));
  const onlineMotorIds = motors
    .filter((motor) => isMotorOnline(motor.id))
    .map((motor) => motor.id);
  const onlineMotorKey = [...onlineMotorIds].sort((a, b) => a - b).join(",");
  const opsDisabled = !primaryMotorId || !primaryOnline;
  const batchDisabled = batchIds.length === 0;
  const setPositionTargetIds =
    batchIds.length > 0
      ? batchIds
      : primaryMotorId && primaryOnline
        ? [primaryMotorId]
        : [];
  const setPositionDisabled = setPositionTargetIds.length === 0;
  const [dynamicOps, setDynamicOps] = useState<DisplayOperation[]>([]);

  useEffect(() => {
    let cancelled = false;
    const productModel = primaryMotor?.productModel;
    if (!productModel) {
      setDynamicOps([]);
      return;
    }
    void preloadMotorModelConfigs().then(() => {
      if (cancelled) return;
      setDynamicOps(variableOperationsForModel(productModel));
    });
    return () => {
      cancelled = true;
    };
  }, [primaryMotor?.productModel]);

  const batchKey = batchIds.join(",");
  const paramsMotorLabel =
    batchIds.length > 1 ? `${batchIds.length} 台电机` : motorLabel;

  useEffect(() => {
    if (!primaryMotorId) {
      setDefaultVelocity(MIXED_DEBUG_PARAM);
      setDefaultAcceleration(MIXED_DEBUG_PARAM);
      setDefaultDeceleration(MIXED_DEBUG_PARAM);
      setMaximumStroke(MIXED_DEBUG_PARAM);
      setAllMotionParams(new Map());
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setParamsOpen(false);
      setMoveOpen(false);
      setSetPositionOpen(false);
    }
  }, [primaryMotorId]);

  useEffect(() => {
    if (!paramsOpen) return;
    const deviceIds =
      onlineMotorKey.length === 0 ? [] : onlineMotorKey.split(",").map(Number);
    if (deviceIds.length === 0) {
      setAllMotionParams(new Map());
      setParamsLoading(false);
      return;
    }
    let cancelled = false;
    setParamsLoading(true);
    void fetchAllDebugMotionParams(deviceIds)
      .then((map) => {
        if (cancelled) return;
        setAllMotionParams(map);
      })
      .finally(() => {
        if (!cancelled) setParamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paramsOpen, onlineMotorKey]);

  useEffect(() => {
    if (!paramsOpen) return;
    if (paramsLoading) {
      setDefaultVelocity(MIXED_DEBUG_PARAM);
      setDefaultAcceleration(MIXED_DEBUG_PARAM);
      setDefaultDeceleration(MIXED_DEBUG_PARAM);
      setMaximumStroke(MIXED_DEBUG_PARAM);
      return;
    }
    const ids = batchKey.length === 0 ? [] : batchKey.split(",").map(Number);
    const shared = mergeDebugMotionParams(ids, allMotionParams);
    const formatShared = (value: number | null) =>
      value === null ? MIXED_DEBUG_PARAM : String(toDebugDisplayValue(value, display));
    if (!shared) {
      setDefaultVelocity(MIXED_DEBUG_PARAM);
      setDefaultAcceleration(MIXED_DEBUG_PARAM);
      setDefaultDeceleration(MIXED_DEBUG_PARAM);
      setMaximumStroke(MIXED_DEBUG_PARAM);
      return;
    }
    setDefaultVelocity(formatShared(shared.defaultVelocity));
    setDefaultAcceleration(formatShared(shared.defaultAcceleration));
    setDefaultDeceleration(formatShared(shared.defaultDeceleration));
    setMaximumStroke(formatShared(shared.maximumStroke));
  }, [paramsOpen, paramsLoading, allMotionParams, batchKey, display]);

  useEffect(() => {
    if (opsDisabled && paramsOpen) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setParamsOpen(false);
    }
  }, [opsDisabled, paramsOpen]);

  useEffect(() => {
    if (setPositionDisabled && moveOpen) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setMoveOpen(false);
    }
  }, [setPositionDisabled, moveOpen]);

  useEffect(() => {
    if ((opsDisabled && batchDisabled) && setPositionOpen) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setSetPositionOpen(false);
    }
  }, [opsDisabled, batchDisabled, setPositionOpen]);

  const closeParamsPopover = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => setParamsOpen(false));
  };

  const closeMovePopover = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => setMoveOpen(false));
  };

  const closeSetPositionPopover = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => setSetPositionOpen(false));
  };

  const relativeQuickDeltas = relativeMoveQuickDeltas(display);

  const executeMove = (displayValue: number, options?: { close?: boolean }) => {
    if (setPositionTargetIds.length === 0) return false;
    if (!Number.isFinite(displayValue)) {
      toast.warning("请输入有效数值");
      return false;
    }
    const deltaOrAbs = roundToTenthMm(toDebugCanonicalValue(displayValue, display));
    const items =
      moveMode === "absolute"
        ? setPositionTargetIds.map((motorId) => ({ motorId, canonicalMm: deltaOrAbs }))
        : setPositionTargetIds.map((motorId) => ({
            motorId,
            canonicalMm: relativeMoveTargetMm(displayPositionOf(motorId), deltaOrAbs),
          }));
    void applyMoveAbsMotor(items, limitRange)
      .then(() => {
        if (options?.close !== false) closeMovePopover();
      })
      .catch(() => {});
    return true;
  };

  const handleMoveExecute = () => {
    executeMove(parseFloat(targetValue));
  };

  const handleRelativeQuickMove = (deltaDisplay: number) => {
    setTargetValue(String(deltaDisplay));
  };

  const handleSetOrigin = async () => {
    if (setPositionTargetIds.length === 0) return;
    const ok = await window.toolAPI.confirm({
      title: "位置归零",
      message: `将 ${setPositionTargetIds.length} 台电机位置归零（设原点）？`,
      danger: true,
    });
    if (!ok) return;
    try {
      await applySetPositionMotor(setPositionTargetIds, 0);
    } catch {
      // silent
    }
  };

  const handleSetPositionExecute = async () => {
    if (setPositionTargetIds.length === 0) return;
    const displayVal = parseFloat(setPositionValue);
    if (!Number.isFinite(displayVal)) {
      toast.warning("请输入有效位置");
      return;
    }
    const canonical = roundToTenthMm(toDebugCanonicalValue(displayVal, display));
    setSetPositionApplying(true);
    try {
      await applySetPositionMotor(setPositionTargetIds, canonical);
      closeSetPositionPopover();
    } catch {
      // silent
    } finally {
      setSetPositionApplying(false);
    }
  };

  const handleApplyMotionParams = async () => {
    const targetIds = batchIds.length > 0 ? batchIds : primaryMotorId ? [primaryMotorId] : [];
    if (targetIds.length === 0) return;

    const resolveField = (
      raw: string,
      key: keyof DebugMotionParams,
      motorId: number,
    ): number | null => {
      if (raw === MIXED_DEBUG_PARAM || raw.trim() === "") {
        return allMotionParams.get(motorId)?.[key] ?? null;
      }
      const displayVal = parseFloat(raw);
      if (!Number.isFinite(displayVal) || displayVal < 0) {
        return allMotionParams.get(motorId)?.[key] ?? null;
      }
      return toDebugCanonicalValue(displayVal, display);
    };

    const items: { motorId: number; params: DebugMotionParams }[] = [];
    for (const motorId of targetIds) {
      const defaultVelocityValue = resolveField(defaultVelocity, "defaultVelocity", motorId);
      const defaultAccelerationValue = resolveField(
        defaultAcceleration,
        "defaultAcceleration",
        motorId,
      );
      const defaultDecelerationValue = resolveField(
        defaultDeceleration,
        "defaultDeceleration",
        motorId,
      );
      const maximumStrokeValue = resolveField(maximumStroke, "maximumStroke", motorId);
      if (
        defaultVelocityValue === null ||
        defaultAccelerationValue === null ||
        defaultDecelerationValue === null ||
        maximumStrokeValue === null
      ) {
        continue;
      }
      items.push({
        motorId,
        params: {
          defaultVelocity: defaultVelocityValue,
          defaultAcceleration: defaultAccelerationValue,
          defaultDeceleration: defaultDecelerationValue,
          maximumStroke: roundToTenthMm(maximumStrokeValue),
        },
      });
    }

    if (items.length === 0) {
      toast.warning("请填写设置数值");
      return;
    }

    setParamsApplying(true);
    try {
      await applyDebugMotionParams(items);
      closeParamsPopover();
    } catch {
      // silent
    } finally {
      setParamsApplying(false);
    }
  };

  const handleResetAlarm = async () => {
    if (batchIds.length === 0) return;
    const ok = await window.toolAPI.confirm({
      title: "报警复位",
      message: `对 ${batchIds.length} 台电机执行报警复位？`,
    });
    if (!ok) return;
    try {
      await applyResetAlarmMotor(batchIds);
    } catch {
      // silent
    }
  };

  const handleClearAlarm = async () => {
    if (batchIds.length === 0) return;
    try {
      await applyClear731AlarmMotor(batchIds);
    } catch {
      // silent
    }
  };

  const handleEnable = async (enabled: boolean) => {
    if (batchIds.length === 0) return;
    try {
      await applyEnableMotor(batchIds, enabled);
    } catch {
      // silent
    }
  };

  const handleCommTest = async () => {
    if (!primaryMotorId || !primaryOnline) return;
    try {
      await applyCommTestMotor([primaryMotorId]);
    } catch {
      // silent
    }
  };

  const handleEStop = async () => {
    if (batchDisabled && opsDisabled) return;
    const ok = await window.toolAPI.confirm({
      title: "急停",
      message: "确认急停？运动将立即中止。",
      danger: true,
    });
    if (!ok) return;
    stop();
  };

  return (
    <div className={cn("flex shrink-0 flex-col gap-2 px-3 py-2", className)}>
      {/* Row1：高频 */}
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        <MotionParamsPopover
          open={paramsOpen}
          onOpenChange={(open) => {
            if (open) setParamsLoading(true);
            setParamsOpen(open);
          }}
          disabled={opsDisabled}
          motorLabel={paramsMotorLabel}
          defaultVelocity={defaultVelocity}
          defaultAcceleration={defaultAcceleration}
          defaultDeceleration={defaultDeceleration}
          maximumStroke={maximumStroke}
          speedUnit={speedUnit}
          accelUnit={accelUnit}
          strokeUnit={positionUnit}
          displayStep={displayStep}
          positionStep={positionStep}
          applying={paramsApplying}
          loading={paramsLoading}
          onDefaultVelocityChange={setDefaultVelocity}
          onDefaultAccelerationChange={setDefaultAcceleration}
          onDefaultDecelerationChange={setDefaultDeceleration}
          onMaximumStrokeChange={setMaximumStroke}
          onCancel={closeParamsPopover}
          onApply={() => void handleApplyMotionParams()}
        />

        <button
          type="button"
          disabled={setPositionDisabled}
          onClick={() => {
            void applyStopMotor(setPositionTargetIds).catch(() => {});
          }}
          className={dangerBtnClass}
        >
          停止
        </button>

        <button
          type="button"
          disabled={setPositionDisabled}
          onClick={() => void handleSetOrigin()}
          className={barBtnClass}
        >
          设原点
        </button>

        <JogButton
          ariaLabel={limitRange ? "限位点动正向" : "点动正向"}
          disabled={setPositionDisabled}
          onHoldStart={() => {
            void applyJogMotor(setPositionTargetIds, 1, limitRange).catch(() => {});
          }}
          onHoldEnd={() => {
            void applyJogMotor(setPositionTargetIds, 0, limitRange).catch(() => {});
          }}
        >
          {limitRange ? (
            <ArrowUpToLine className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowUp className="h-4 w-4" aria-hidden />
          )}
        </JogButton>
        <JogButton
          ariaLabel={limitRange ? "限位点动反向" : "点动反向"}
          disabled={setPositionDisabled}
          onHoldStart={() => {
            void applyJogMotor(setPositionTargetIds, -1, limitRange).catch(() => {});
          }}
          onHoldEnd={() => {
            void applyJogMotor(setPositionTargetIds, 0, limitRange).catch(() => {});
          }}
        >
          {limitRange ? (
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDown className="h-4 w-4" aria-hidden />
          )}
        </JogButton>

        <Popover
          modal={false}
          open={moveOpen}
          onOpenChange={(open) => {
            if (!open) {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              requestAnimationFrame(() => setMoveOpen(false));
              return;
            }
            setMoveOpen(true);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={setPositionDisabled}
              aria-label="位置移动"
              className={barBtnClass}
            >
              位置移动
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={8}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
            className="w-72 border-border/60 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
          >
            <div className="bg-muted px-3 py-2">
              <p className="text-label-caps text-muted-foreground">位置移动</p>
            </div>
            <div className="space-y-3 bg-background p-3">
              <div className="flex flex-col gap-1">
                <span className="text-body-sm text-muted-foreground">移动方式</span>
                <ToggleGroup
                  type="single"
                  value={moveMode}
                  onValueChange={(value) => {
                    if (value === "absolute" || value === "relative") {
                      setMoveMode(value);
                      if (value === "relative") {
                        setTargetValue("0");
                      }
                    }
                  }}
                  variant="outline"
                  className="w-full border"
                  aria-label="移动方式"
                >
                  <ToggleGroupItem
                    value="absolute"
                    className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
                  >
                    绝对
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="relative"
                    className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
                  >
                    相对
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {moveMode === "relative" ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-body-sm text-muted-foreground">快捷位移 ({positionUnit})</span>
                  <div className="grid grid-cols-4 gap-1">
                    {relativeQuickDeltas.map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => handleRelativeQuickMove(delta)}
                        aria-label={`相对移动 ${formatRelativeQuickLabel(delta, display)} ${positionUnit}`}
                        className="inline-flex h-9 items-center justify-center rounded-md bg-input-background font-mono text-mono-sm tabular-nums text-foreground hover:bg-accent"
                      >
                        {formatRelativeQuickLabel(delta, display)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-body-sm text-muted-foreground">
                  {moveMode === "absolute"
                    ? `目标位置 (${positionUnit})`
                    : `自定义位移 (${positionUnit})`}
                </span>
                <Input
                  type="number"
                  showStepper
                  step={positionStep}
                  value={targetValue}
                  aria-label={
                    moveMode === "absolute"
                      ? `目标位置 ${positionUnit}`
                      : `自定义位移 ${positionUnit}`
                  }
                  onChange={(event) => setTargetValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleMoveExecute();
                    }
                  }}
                  className="text-right font-mono text-mono-sm tabular-nums"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 bg-muted px-3 py-2">
              <button
                type="button"
                onClick={closeMovePopover}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleMoveExecute}
                className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground"
              >
                执行
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "收起更多操作" : "展开更多操作"}
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(barBtnClass, "ml-auto gap-1")}
        >
          更多
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>

      {expanded ? (
        <>
          {/* Row2：限制范围 + 安全/复位 */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <Checkbox
              checked={limitRange}
              onCheckedChange={(checked) => setLimitRange(checked === true)}
            >
              限制范围
            </Checkbox>
            <div className="mx-1 hidden h-6 w-px bg-border/60 sm:block" aria-hidden />

            <Popover
              modal={false}
              open={setPositionOpen}
              onOpenChange={(open) => {
                if (!open) {
                  closeSetPositionPopover();
                  return;
                }
                setSetPositionOpen(true);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={setPositionDisabled}
                  aria-label="设定位移（需参数）"
                  className={cn(barBtnClass, "gap-1")}
                >
                  设定位移
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                }}
                className="w-72 border-border/60 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
              >
                <div className="bg-muted px-3 py-2">
                  <p className="text-label-caps text-muted-foreground">设定位移</p>
                  <p className="mt-0.5 font-mono text-mono-sm tabular-nums text-foreground">
                    {setPositionTargetIds.length > 1
                      ? `${setPositionTargetIds.length} 台电机`
                      : motorLabel}
                  </p>
                </div>
                <div className="space-y-3 bg-background p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-body-sm text-muted-foreground">
                      位置 ({positionUnit})
                    </span>
                    <Input
                      type="number"
                      showStepper
                      step={positionStep}
                      value={setPositionValue}
                      disabled={setPositionApplying}
                      aria-label={`设定位移 ${positionUnit}`}
                      onChange={(event) => setSetPositionValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSetPositionExecute();
                        }
                      }}
                      className="text-right font-mono text-mono-sm tabular-nums"
                    />
                  </label>
                  <p className="text-body-sm text-muted-foreground">位置为 0 时等价设原点</p>
                </div>
                <div className="flex justify-end gap-2 bg-muted px-3 py-2">
                  <button
                    type="button"
                    disabled={setPositionApplying}
                    onClick={closeSetPositionPopover}
                    className="inline-flex h-9 items-center rounded-md border border-border px-3 text-body-sm text-foreground hover:bg-accent disabled:opacity-40"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={setPositionApplying}
                    onClick={() => void handleSetPositionExecute()}
                    className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    执行
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            <button
              type="button"
              disabled={batchDisabled}
              onClick={() => void handleResetAlarm()}
              className={barBtnClass}
            >
              复位
            </button>
            <button
              type="button"
              disabled={batchDisabled}
              onClick={() => void handleClearAlarm()}
              className={barBtnClass}
            >
              清报警
            </button>
            <button
              type="button"
              disabled={batchDisabled}
              onClick={() => void handleEnable(true)}
              className={barBtnClass}
            >
              使能
            </button>
            <button
              type="button"
              disabled={batchDisabled}
              onClick={() => void handleEnable(false)}
              className={barBtnClass}
            >
              断使能
            </button>
            <button
              type="button"
              disabled={opsDisabled}
              onClick={() => void handleCommTest()}
              className={barBtnClass}
            >
              通讯检测
            </button>
          </div>

          {/* Row4：描述文件 variableOperation（≤4） */}
          {dynamicOps.length > 0 ? (
            <div className="flex flex-wrap items-center border-t border-border/40 pt-2">
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {dynamicOps.map((operation) => (
                  <DynamicOpSlot
                    key={operation.id}
                    operation={operation}
                    disabled={opsDisabled || !primaryMotor}
                    motorLabel={motorLabel}
                    mid={primaryMotor?.id ?? 0}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
