import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { NumericInput } from "@/app/components/ics/numeric-input";
import { UnitAwareNumericInput } from "@/app/components/ics/unit-aware-numeric-input";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import {
  CONTROL_TYPE_RULES,
  maxDriveAxesForControlType,
} from "@/app/project/configuration-rules";
import {
  MAX_INITIAL_TILT_DIRECTION,
  MAX_MOUNT_ROTATION,
  normalizeInitialTiltDirection,
  normalizeSafetyRadius,
} from "@/app/project/hoist-point-defaults";
import { isAxisBound } from "@/app/pages/console/hooks/binding-utils";
import type { MultiPointAxesConfigurationInput } from "@/app/pages/console/hooks/setup-operations";
import { useViz3DContext } from "@/app/pages/console/3d/Viz3DProvider";
import type { AxisMount, ControlledObject, Motor, Plc } from "../config-wizard-types";
import {
  MultiPointAxesCanvas,
  type MultiPointAxesBackgroundImage,
} from "./multi-point-axes-canvas";
import { MultiPointAxisList } from "./multi-point-axis-list";
import {
  addDraftAxis,
  applyFirstCircleChordToAll,
  applyFirstLineSpacingToAll,
  createMultiPointAxesDraft,
  insertDraftAxisRelative,
  isMultiPointAxesDraftDirty,
  removeDraftAxis,
  setDraftAxisBind,
  setDraftAxisUnbind,
  setDraftMountLayoutKind,
  toPersistedMountLayout,
  updateDraftAxisMount,
  updateDraftCircleChord,
  updateDraftCircleRadius,
  updateDraftLineSpacing,
  updateDraftMountRotation,
  validateMultiPointAxesDraft,
  type MultiPointAxesDraft,
} from "./multi-point-axes-draft";
import type { AxisInsertPosition } from "../axis-row-more-menu";
import {
  resolveCircleMountLayout,
  totalAbsoluteChordError,
} from "./multi-point-axes-circle-layout";
import {
  applyDistributedMounts,
  distributeMounts,
  listDistributeStrategies,
  type DistributeStrategyId,
} from "./multi-point-axes-distribute";
import { createShapeFootprint } from "./multi-point-axes-geometry";
import { formatAxisLabel } from "../axis-utils";

export type MultiPointAxesDialogProps = {
  open: boolean;
  object: ControlledObject;
  motors: readonly Motor[];
  plcs: readonly Plc[];
  /** When provided on open, selects this axis if it exists in the draft. */
  initialSelectedAxisKey?: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: (
    input: MultiPointAxesConfigurationInput,
  ) => boolean | { applied: boolean; reason?: string };
};

const emptyDraft = (): MultiPointAxesDraft => ({
  safetyRadius: 0,
  initialTiltDirection: 0,
  mountRotation: 0,
  mountLayout: { kind: "custom" },
  axes: [],
  unbindAxisKeys: [],
  pendingBinds: {},
});

export const MultiPointAxesDialog = ({
  open,
  object,
  motors,
  plcs,
  initialSelectedAxisKey = null,
  onOpenChange,
  onApply,
}: MultiPointAxesDialogProps) => {
  const [initialDraft, setInitialDraft] = useState<MultiPointAxesDraft>(emptyDraft);
  const [draft, setDraft] = useState<MultiPointAxesDraft>(emptyDraft);
  const [selectedAxisKey, setSelectedAxisKey] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingBoundRemovalKey, setPendingBoundRemovalKey] = useState<string | null>(
    null,
  );
  const [topViewBackground, setTopViewBackground] =
    useState<MultiPointAxesBackgroundImage | null>(null);
  const previousOpenRef = useRef(false);
  const engine = useViz3DContext();
  const shapeWidth =
    object.shapeDimensions && "width" in object.shapeDimensions
      ? object.shapeDimensions.width
      : undefined;
  const shapeDepth =
    object.shapeDimensions && "depth" in object.shapeDimensions
      ? object.shapeDimensions.depth
      : undefined;

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (!open || wasOpen) return;

    // Separate clones so draft mutations never alias initialDraft.
    const nextInitial = createMultiPointAxesDraft(object);
    const nextDraft = createMultiPointAxesDraft(object);
    setInitialDraft(nextInitial);
    setDraft(nextDraft);
    const preferredKey =
      initialSelectedAxisKey &&
      nextDraft.axes.some((axis) => axis.key === initialSelectedAxisKey)
        ? initialSelectedAxisKey
        : (nextDraft.axes[0]?.key ?? null);
    setSelectedAxisKey(preferredKey);
    setDiscardConfirmOpen(false);
    setPendingBoundRemovalKey(null);
  }, [open, object, initialSelectedAxisKey]);

  useEffect(() => {
    if (!open) {
      setTopViewBackground(null);
      return;
    }
    if (object.shapePreset !== "external" || !object.modelId) {
      setTopViewBackground(null);
      return;
    }

    let cancelled = false;
    void engine.captureObjectTopViewPng(String(object.id)).then((capture) => {
      if (cancelled) return;
      if (!capture) {
        setTopViewBackground(null);
        return;
      }
      setTopViewBackground({
        href: capture.pngBase64,
        boundsMm: capture.boundsMm,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    engine,
    object.id,
    object.modelId,
    object.shapePreset,
    shapeWidth,
    shapeDepth,
  ]);

  const footprint = useMemo(() => createShapeFootprint(object), [object]);
  const isMultiPointSwing = object.controlType === "multiPointSwing";
  const minimumAxes = CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes;
  const maximumAxes = maxDriveAxesForControlType(object.controlType);
  const canAddAxis = maximumAxes === undefined || draft.axes.length < maximumAxes;
  const isCustomLayout = draft.mountLayout.kind === "custom";
  const distributeStrategies = useMemo(
    () => (isCustomLayout ? listDistributeStrategies(footprint) : []),
    [footprint, isCustomLayout],
  );
  const circleLayoutResult = useMemo(() => {
    if (draft.mountLayout.kind !== "circle") return null;
    return resolveCircleMountLayout(
      draft.mountLayout.radius,
      draft.mountLayout.chordLengths,
      { mountRotation: draft.mountRotation },
    );
  }, [draft.mountLayout, draft.mountRotation]);
  const layoutCircleRadiusMm =
    draft.mountLayout.kind === "circle" ? draft.mountLayout.radius : null;
  const totalChordErrorMm =
    circleLayoutResult?.ok === true
      ? totalAbsoluteChordError(circleLayoutResult.segments)
      : null;
  const issues = useMemo(
    () => validateMultiPointAxesDraft(draft, footprint, minimumAxes),
    [draft, footprint, minimumAxes],
  );
  const invalidAxisKeys = useMemo(
    () =>
      new Set(issues.flatMap((issue) => (issue.axisKey ? [issue.axisKey] : []))),
    [issues],
  );
  const dirty = isMultiPointAxesDraftDirty(initialDraft, draft);
  const boundAxisKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const axis of draft.axes) {
      if (isAxisBound(object.id, axis.key, motors)) keys.add(axis.key);
    }
    return keys;
  }, [draft.axes, object.id, motors]);
  const canApply = issues.length === 0;

  const handleRequestClose = () => {
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    handleRequestClose();
  };

  const handleDiscard = () => {
    setDiscardConfirmOpen(false);
    onOpenChange(false);
  };

  const handleApply = () => {
    if (!canApply) return;
    const result = onApply({
      axes: draft.axes,
      safetyRadius: draft.safetyRadius,
      initialTiltDirection: draft.initialTiltDirection,
      mountRotation: draft.mountRotation,
      mountLayout: toPersistedMountLayout(draft.mountLayout),
      unbindAxisKeys: draft.unbindAxisKeys,
      bindAxisMotors: Object.entries(draft.pendingBinds).map(([axisKey, motorId]) => ({
        axisKey,
        motorId,
      })),
    });
    const applied = typeof result === "boolean" ? result : result.applied;
    const reason = typeof result === "boolean" ? undefined : result.reason;
    if (!applied) {
      toast.error(reason ? `吊点配置保存失败：${reason}` : "吊点配置保存失败");
      return;
    }
    toast.success("吊点配置已保存");
    onOpenChange(false);
  };

  const handleBindChange = (axisKey: string, motorId: number | null) => {
    setDraft((previous) =>
      motorId === null
        ? setDraftAxisUnbind(previous, object.id, axisKey, motors)
        : setDraftAxisBind(previous, object.id, axisKey, motorId, motors),
    );
  };

  const handleAxisMountChange = (axisKey: string, mount: AxisMount) => {
    setDraft((previous) => updateDraftAxisMount(previous, axisKey, mount));
  };

  const handleListMountChange = (axisKey: string, patch: Partial<AxisMount>) => {
    setDraft((previous) => updateDraftAxisMount(previous, axisKey, patch));
  };

  const applyAxisRemoval = (axisKey: string) => {
    let fallbackKey: string | null = null;
    setDraft((previous) => {
      const next = removeDraftAxis(previous, axisKey, minimumAxes);
      fallbackKey = next.axes[0]?.key ?? null;
      return next;
    });
    setSelectedAxisKey((current) => (current === axisKey ? fallbackKey : current));
  };

  const handleAddAxis = () => {
    let addedKey: string | null = null;
    setDraft((previous) => {
      const next = addDraftAxis(previous);
      addedKey = next.axes.at(-1)?.key ?? null;
      return next;
    });
    if (addedKey !== null) setSelectedAxisKey(addedKey);
  };

  const handleInsertRelative = (axisKey: string, position: AxisInsertPosition) => {
    let insertedKey: string | null = null;
    setDraft((previous) => {
      const next = insertDraftAxisRelative(previous, axisKey, position);
      if (next === previous) return previous;
      const anchorIndex = previous.axes.findIndex((axis) => axis.key === axisKey);
      const insertAt = position === "before" ? anchorIndex : anchorIndex + 1;
      insertedKey = next.axes[insertAt]?.key ?? null;
      return next;
    });
    if (insertedKey !== null) setSelectedAxisKey(insertedKey);
  };

  const handleDistribute = (strategyId: DistributeStrategyId) => {
    setDraft((previous) => {
      if (previous.axes.length === 0) return previous;
      const mounts = distributeMounts(
        footprint,
        strategyId,
        previous.axes.length,
        { initialTiltDirection: previous.mountRotation },
      );
      return {
        ...previous,
        axes: applyDistributedMounts(previous.axes, mounts),
      };
    });
  };

  const handleRemove = (axisKey: string) => {
    if (isAxisBound(object.id, axisKey, motors)) {
      setPendingBoundRemovalKey(axisKey);
      return;
    }
    applyAxisRemoval(axisKey);
  };

  const handleConfirmBoundRemoval = () => {
    if (!pendingBoundRemovalKey) return;
    const axisKey = pendingBoundRemovalKey;
    setPendingBoundRemovalKey(null);
    applyAxisRemoval(axisKey);
  };

  const pendingBoundRemovalIndex = pendingBoundRemovalKey
    ? draft.axes.findIndex((axis) => axis.key === pendingBoundRemovalKey)
    : -1;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogPortal>
          <DialogOverlay
            className="bg-background/80"
            onPointerDown={(event) => {
              event.preventDefault();
              handleRequestClose();
            }}
          />
          <DialogPrimitive.Content
            className={cn(
              "bg-card",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              // inset + m-auto 居中，避免 translate(-50%,-50%) / zoom 半像素导致文字发糊
              "fixed inset-0 z-50 m-auto flex h-[min(760px,calc(100vh-48px))] w-full max-w-[min(1200px,calc(100vw-48px))]",
              "flex-col overflow-hidden rounded-lg",
              "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
            )}
            onInteractOutside={(event) => {
              // Nested AlertDialog focus must not dismiss / stack discard on the main dialog.
              event.preventDefault();
              const originalType = event.detail.originalEvent.type;
              if (originalType === "focusin") return;
              handleRequestClose();
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              handleRequestClose();
            }}
          >
            <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
              <DialogTitle className="text-heading-lg font-semibold text-foreground">
                吊点配置
              </DialogTitle>
              <button
                type="button"
                aria-label="关闭"
                onClick={handleRequestClose}
                className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <DialogDescription className="sr-only">
              配置吊点位置、布局与绑定
            </DialogDescription>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <div className="min-h-0 bg-canvas p-3">
                <MultiPointAxesCanvas
                  object={object}
                  axes={draft.axes}
                  safetyRadius={draft.safetyRadius}
                  initialTiltDirection={draft.initialTiltDirection}
                  selectedAxisKey={selectedAxisKey}
                  boundAxisKeys={boundAxisKeys}
                  invalidAxisKeys={invalidAxisKeys}
                  mountsEditable={isCustomLayout}
                  layoutCircleRadiusMm={layoutCircleRadiusMm}
                  totalChordErrorMm={totalChordErrorMm}
                  backgroundImage={topViewBackground}
                  onSelectedAxisChange={setSelectedAxisKey}
                  onAxisMountChange={handleAxisMountChange}
                />
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden bg-background">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  {isMultiPointSwing ? (
                    <div className="space-y-3 rounded-md bg-muted p-4">
                      <div className="space-y-1">
                        <span className="text-body-sm text-muted-foreground">
                          安全范围半径
                        </span>
                        <UnitAwareNumericInput
                          value={draft.safetyRadius}
                          min={0}
                          step={1}
                          precision={1}
                          unit="mm"
                          aria-label="安全范围半径"
                          onChange={(safetyRadius) =>
                            setDraft((previous) => ({
                              ...previous,
                              safetyRadius: normalizeSafetyRadius(safetyRadius),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-body-sm text-muted-foreground">
                          初始倾斜角度
                        </span>
                        <NumericInput
                          value={draft.initialTiltDirection}
                          min={0}
                          max={MAX_INITIAL_TILT_DIRECTION}
                          step={1}
                          precision={0}
                          unit="deg"
                          aria-label="初始倾斜角度"
                          onChange={(initialTiltDirection) =>
                            setDraft((previous) => ({
                              ...previous,
                              initialTiltDirection:
                                normalizeInitialTiltDirection(initialTiltDirection),
                            }))
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3 rounded-md bg-muted p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-label-caps text-muted-foreground">吊点配置</p>
                        <p className="mt-0.5 text-body-sm text-muted-foreground">
                          {maximumAxes !== undefined
                            ? `固定 ${maximumAxes} 吊点 · 当前 ${draft.axes.length} 吊点`
                            : `至少 ${minimumAxes} 吊点 · 当前 ${draft.axes.length} 吊点`}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!canAddAxis}
                        onClick={handleAddAxis}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/60 bg-background px-3 text-body-sm text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        添加吊点
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <span className="text-body-sm text-muted-foreground">布局</span>
                        <Select
                          aria-label="吊点布局"
                          value={draft.mountLayout.kind}
                          options={[
                            { value: "custom", label: "自定义" },
                            { value: "line", label: "直线" },
                            { value: "circle", label: "圆形" },
                          ]}
                          onValueChange={(value) => {
                            if (value !== "custom" && value !== "line" && value !== "circle") {
                              return;
                            }
                            setDraft((previous) =>
                              setDraftMountLayoutKind(previous, value),
                            );
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-body-sm text-muted-foreground">
                          吊点旋转
                        </span>
                        <NumericInput
                          value={draft.mountRotation}
                          min={0}
                          max={MAX_MOUNT_ROTATION}
                          step={1}
                          precision={0}
                          unit="deg"
                          aria-label="吊点旋转"
                          onChange={(mountRotation) =>
                            setDraft((previous) =>
                              updateDraftMountRotation(previous, mountRotation),
                            )
                          }
                        />
                      </div>
                    </div>

                    {isCustomLayout && distributeStrategies.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {distributeStrategies.map((strategy) => (
                          <button
                            key={strategy.id}
                            type="button"
                            disabled={draft.axes.length === 0}
                            aria-label={strategy.label}
                            onClick={() => handleDistribute(strategy.id)}
                            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {strategy.label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {draft.mountLayout.kind === "circle" ? (
                      <div className="space-y-3 rounded-md bg-card p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-body-sm text-muted-foreground w-20">
                            吊点半径
                          </span>
                          <div className="flex-1">
                            <UnitAwareNumericInput
                              value={draft.mountLayout.radius ?? 0}
                              mixed={draft.mountLayout.radius === null}
                              min={0}
                              step={1}
                              precision={1}
                              unit="mm"
                              aria-label="吊点半径"
                              onChange={(radius) =>
                                setDraft((previous) =>
                                  updateDraftCircleRadius(previous, radius),
                                )
                              }
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body-sm text-muted-foreground">
                              现场测量相邻距离
                            </span>
                            <button
                              type="button"
                              disabled={
                                typeof draft.mountLayout.chordLengths[0] !== "number" ||
                                !Number.isFinite(draft.mountLayout.chordLengths[0]) ||
                                draft.mountLayout.chordLengths[0]! <= 0
                              }
                              aria-label="将其余段设为与第一段相同"
                              onClick={() =>
                                setDraft((previous) => applyFirstCircleChordToAll(previous))
                              }
                              className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              同一值
                            </button>
                          </div>
                          {draft.mountLayout.chordLengths.map((chord, index) => {
                            const fromLabel = formatAxisLabel(index);
                            const toLabel = formatAxisLabel(
                              (index + 1) % Math.max(draft.axes.length, 1),
                            );
                            return (
                              <div key={`chord-${index}`} className="flex items-center gap-2">
                                <span className="text-body-sm text-muted-foreground w-20">
                                  {fromLabel}–{toLabel}
                                </span>
                                <div className="flex-1">
                                  <UnitAwareNumericInput
                                    value={chord ?? 0}
                                    mixed={chord === null}
                                    min={0}
                                    step={1}
                                    precision={1}
                                    unit="mm"
                                    aria-label={`${fromLabel}到${toLabel}距离`}
                                    onChange={(value) =>
                                      setDraft((previous) =>
                                        updateDraftCircleChord(previous, index, value),
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {draft.mountLayout.kind === "line" ? (
                      <div className="space-y-3 rounded-md bg-card p-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body-sm text-muted-foreground">
                              相邻吊点间距
                            </span>
                            <button
                              type="button"
                              disabled={
                                typeof draft.mountLayout.spacings[0] !== "number" ||
                                !Number.isFinite(draft.mountLayout.spacings[0]) ||
                                draft.mountLayout.spacings[0]! <= 0
                              }
                              aria-label="将其余段设为与第一段相同"
                              onClick={() =>
                                setDraft((previous) => applyFirstLineSpacingToAll(previous))
                              }
                              className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-body-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              同一值
                            </button>
                          </div>
                          {draft.mountLayout.spacings.map((spacing, index) => {
                            const fromLabel = formatAxisLabel(index);
                            const toLabel = formatAxisLabel(index + 1);
                            return (
                              <div key={`spacing-${index}`} className="flex items-center gap-2">
                                <span className="w-20 text-body-sm text-muted-foreground">
                                  {fromLabel}–{toLabel}
                                </span>
                                <div className="flex-1">
                                  <UnitAwareNumericInput
                                    value={spacing ?? 0}
                                    mixed={spacing === null}
                                    min={0}
                                    step={1}
                                    precision={1}
                                    unit="mm"
                                    aria-label={`${fromLabel}到${toLabel}距离`}
                                    onChange={(value) =>
                                      setDraft((previous) =>
                                        updateDraftLineSpacing(previous, index, value),
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <MultiPointAxisList
                      axes={draft.axes}
                      motors={motors}
                      plcs={plcs}
                      objectId={object.id}
                      draft={draft}
                      selectedAxisKey={selectedAxisKey}
                      invalidAxisKeys={invalidAxisKeys}
                      minimumAxes={minimumAxes}
                      maxAxes={maximumAxes}
                      mountsReadOnly={!isCustomLayout}
                      onSelect={setSelectedAxisKey}
                      onMountChange={handleListMountChange}
                      onBindChange={handleBindChange}
                      onInsertRelative={handleInsertRelative}
                      onRemove={handleRemove}
                    />

                    {issues.length > 0 ? (
                      <ul className="space-y-1 rounded-md bg-input-background px-3 py-2">
                        {issues.map((issue) => (
                          <li
                            key={`${issue.code}-${issue.axisKey ?? "global"}-${issue.message}`}
                            className="text-body-sm text-warning"
                          >
                            {issue.axisKey ? (
                              <button
                                type="button"
                                className="text-left text-warning underline-offset-2 hover:underline"
                                onClick={() => setSelectedAxisKey(issue.axisKey!)}
                              >
                                {issue.message}
                              </button>
                            ) : (
                              issue.message
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex h-12 shrink-0 flex-row-reverse items-center gap-2 bg-muted px-4">
              <Button type="button" disabled={!canApply} onClick={handleApply}>
                应用
              </Button>
              <Button type="button" variant="ghost" onClick={handleRequestClose}>
                取消
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <AlertDialog
        open={discardConfirmOpen}
        onOpenChange={(next) => !next && setDiscardConfirmOpen(false)}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未应用的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              关闭后，本次吊点位置和参数修改将不会保存。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscard}>放弃修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingBoundRemovalKey !== null}
        onOpenChange={(next) => !next && setPendingBoundRemovalKey(null)}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>删除已绑定吊点</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBoundRemovalIndex >= 0
                ? `${formatAxisLabel(pendingBoundRemovalIndex)} 已绑定驱动单元，删除将在应用后解绑。是否继续？`
                : "该吊点已绑定驱动单元，删除将在应用后解绑。是否继续？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBoundRemoval}>
              删除并解绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
