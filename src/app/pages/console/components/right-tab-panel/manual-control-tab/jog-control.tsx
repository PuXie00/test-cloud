import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Slider } from "@/app/components/ui/slider";
import { NumericInput } from "@/app/components/ics/numeric-input";
import { useProject } from "@/app/project/use-project";
import { useProjectDocument } from "@/app/project/use-project-document";
import {
  DEFAULT_MANUAL_JOG,
  DIMENSION_KEY_TO_VIRTUAL_AXIS,
  normalizeManualJog,
} from "@/app/project/manual-jog";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import { resolveJogAxisMaxVelocity } from "@/app/project/virtual-axis-max-velocity";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { DimensionDescriptor } from "../../monitor-grid/monitor-data";
import { useSelection } from "../../../hooks/use-selection";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useProjectStore } from "../../../hooks/use-project-store";
import { buildJogModelItems, sendJogModel } from "../../../hooks/manual-commands";

type JogControlProps = {
  dimensions: DimensionDescriptor[];
};

type AxisJogParams = {
  velocity: number;
  accelDecelTime: number;
};

type JogHoldSnapshot = {
  deviceIds: number[];
  dimKey: string;
  useDefaultSpeed: boolean;
  velocity: number;
  accelDecelTime: number;
};

const isAngleAxis = (unit: string): boolean => unit.includes("°");

const speedUnit = (unit: string): string => `${unit}/s`;

const velocityRangeFallback = (unit: string): { min: number; max: number } =>
  isAngleAxis(unit) ? { min: 0, max: 30 } : { min: 0, max: 200 };

const axisFor = (dim: DimensionDescriptor): VirtualAxisId =>
  DIMENSION_KEY_TO_VIRTUAL_AXIS[dim.key] ?? "v1";

type JogButtonsProps = {
  dimKey: string;
  onJogStart: (dimKey: string, dir: 1 | -1) => void;
  onJogStop: (dimKey: string) => void;
};

const JogButtons = ({ dimKey, onJogStart, onJogStop }: JogButtonsProps) => (
  <div className="flex min-w-0 flex-1 gap-2">
    <button
      type="button"
      aria-label="负向点动"
      onPointerDown={() => onJogStart(dimKey, -1)}
      onPointerUp={() => onJogStop(dimKey)}
      onPointerCancel={() => onJogStop(dimKey)}
      onPointerLeave={() => onJogStop(dimKey)}
      className="inline-flex h-9 flex-1 items-center justify-center rounded-sm text-background bg-foreground hover:bg-foreground/80"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
    </button>
    <button
      type="button"
      aria-label="正向点动"
      onPointerDown={() => onJogStart(dimKey, 1)}
      onPointerUp={() => onJogStop(dimKey)}
      onPointerCancel={() => onJogStop(dimKey)}
      onPointerLeave={() => onJogStop(dimKey)}
      className="inline-flex h-9 flex-1 items-center justify-center rounded-sm text-background bg-foreground hover:bg-foreground/80"
    >
      <ChevronRight className="h-5 w-5" aria-hidden />
    </button>
  </div>
);

export const JogControl = ({ dimensions }: JogControlProps) => {
  const { persistManualJog } = useProject();
  const document = useProjectDocument();
  const dimensionKey = dimensions.map((dim) => dim.key).join(",");

  const manualJog = useMemo(
    () => normalizeManualJog(document?.setup.manualJog),
    [document?.setup.manualJog],
  );

  const buildDraft = useCallback((): Record<string, AxisJogParams> => {
    const next: Record<string, AxisJogParams> = {};
    for (const dim of dimensions) {
      const axis = axisFor(dim);
      next[dim.key] = manualJog[axis] ?? DEFAULT_MANUAL_JOG[axis]!;
    }
    return next;
  }, [dimensions, manualJog]);

  const [draft, setDraft] = useState<Record<string, AxisJogParams>>(buildDraft);
  const [useDefaultSpeed, setUseDefaultSpeed] = useState(true);

  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();
  const { objects, motors } = useProjectStore();
  const jogHoldRef = useRef<JogHoldSnapshot | null>(null);

  const selectedIds =
    multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
  const deviceIds = selectedIds.flatMap((id) => (getById(id) ? [id] : []));
  const selectedObjects = selectedIds
    .map((id) => objects.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => item != null);

  const stopHoldingJog = useCallback(() => {
    const snapshot = jogHoldRef.current;
    if (!snapshot) return;
    jogHoldRef.current = null;
    void sendJogModel(
      buildJogModelItems({
        deviceIds: snapshot.deviceIds,
        dimKey: snapshot.dimKey,
        dir: 0,
        useDefaultSpeed: snapshot.useDefaultSpeed,
        velocity: snapshot.velocity,
        accelDecelTime: snapshot.accelDecelTime,
      }),
    );
  }, []);

  const handleJogStart = (dimKey: string, dir: 1 | -1) => {
    const dim = dimensions.find((item) => item.key === dimKey);
    if (!dim) return;
    const params = draft[dimKey] ?? DEFAULT_MANUAL_JOG[axisFor(dim)]!;
    const snapshot: JogHoldSnapshot = {
      deviceIds: [...deviceIds],
      dimKey,
      useDefaultSpeed,
      velocity: params.velocity,
      accelDecelTime: params.accelDecelTime,
    };
    jogHoldRef.current = snapshot;
    void sendJogModel(
      buildJogModelItems({
        ...snapshot,
        dir,
      }),
    );
  };

  const handleJogStop = (dimKey: string) => {
    if (jogHoldRef.current?.dimKey !== dimKey) return;
    stopHoldingJog();
  };

  useEffect(() => {
    const onBlurOrHide = () => stopHoldingJog();
    window.addEventListener("blur", onBlurOrHide);
    const onVisibilityChange = () => {
      if (globalThis.document.visibilityState === "hidden") onBlurOrHide();
    };
    globalThis.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlurOrHide);
      globalThis.document.removeEventListener("visibilitychange", onVisibilityChange);
      stopHoldingJog();
    };
  }, [stopHoldingJog]);

  useEffect(() => {
    setDraft(buildDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionKey, manualJog]);

  const commit = useCallback(
    async (next: Record<string, AxisJogParams>) => {
      const jog = normalizeManualJog(document?.setup.manualJog);
      for (const dim of dimensions) {
        jog[axisFor(dim)] = next[dim.key];
      }
      try {
        await persistManualJog(jog);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "点动参数保存失败");
      }
    },
    [dimensions, document?.setup.manualJog, persistManualJog],
  );

  return (
    <div className="space-y-2 px-3">
      <div className="rounded-md overflow-hidden">
        <div className="flex h-9 items-center justify-between bg-muted px-3">
          <span>点动控制</span>
          <Checkbox
            checked={useDefaultSpeed}
            onCheckedChange={(checked) => setUseDefaultSpeed(checked === true)}
          >
            默认速度
          </Checkbox>
        </div>
        <div className="bg-background px-3 py-1">
          <div className="">
            {dimensions.map((dim, index) => {
              const value = draft[dim.key] ?? DEFAULT_MANUAL_JOG[axisFor(dim)]!;
              const jogMax = resolveJogAxisMaxVelocity(
                axisFor(dim),
                selectedObjects.map((item) => ({
                  id: item.id,
                  enabledVirtualAxes: ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[item.controlType],
                  pMaxVelocity: item.pMaxVelocity,
                  yMaxVelocity: item.yMaxVelocity,
                })),
                motors,
              );
              const fallback = velocityRangeFallback(dim.unit);
              const range = {
                min: 0,
                max: jogMax ?? fallback.max,
              };
              const displayVelocity = Math.min(value.velocity, range.max);
              return (
                <div
                  key={dim.key}
                  className="space-y-2  border-b-3 border-card-muted py-2 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-body-sm text-foreground">
                      虚轴{index + 1} {dim.label}
                    </span>
                    <JogButtons dimKey={dim.key} onJogStart={handleJogStart} onJogStop={handleJogStop} />
                  </div>
                  {!useDefaultSpeed ? (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="w-6 shrink-0 text-body-sm text-muted-foreground">速度</span>
                        <Slider
                          value={[displayVelocity]}
                          min={range.min}
                          max={range.max}
                          step={1}
                          aria-label={`虚轴${index + 1} ${dim.label} 速度`}
                          className="flex-1"
                          onValueChange={(next) =>
                            setDraft((prev) => ({
                              ...prev,
                              [dim.key]: { ...prev[dim.key]!, velocity: next[0] ?? range.min },
                            }))
                          }
                          onValueCommit={(next) => {
                            const nextDraft = {
                              ...draft,
                              [dim.key]: { ...draft[dim.key]!, velocity: next[0] ?? range.min },
                            };
                            setDraft(nextDraft);
                            void commit(nextDraft);
                          }}
                        />
                        <span className="w-14 shrink-0 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
                          {displayVelocity} {dim.mixed ? "--" : speedUnit(dim.unit)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-body-sm text-muted-foreground">加减速时间</span>
                        <NumericInput
                          value={value.accelDecelTime}
                          min={0}
                          step={0.5}
                          precision={1}
                          unit="s"
                          aria-label={`虚轴${index + 1} ${dim.label} 加减速时间`}
                          onChange={(next) =>
                            setDraft((prev) => ({
                              ...prev,
                              [dim.key]: { ...prev[dim.key]!, accelDecelTime: next },
                            }))
                          }
                          onCommit={(next) => {
                            const nextDraft = {
                              ...draft,
                              [dim.key]: { ...draft[dim.key]!, accelDecelTime: next },
                            };
                            setDraft(nextDraft);
                            void commit(nextDraft);
                          }}
                          className="w-28"
                        />
                      </div>
                    </>
                  ) : null}
                  {dim.mixed && (
                    <p className="text-body-sm text-warning">单位不一致，按 mm 处理</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
