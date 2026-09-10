import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/app/components/ui/utils";
import { sampleVelocityNorm } from "@/app/project/action-sequence/motion-profile";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import { profileKindMeta } from "./profile-kind";

export type VelocityChartLimits = {
  maxVelocity?: number;
  peakVelocity: number;
};

export type VelocityChartProps = {
  profile: MotionProfile;
  durationMs: number;
  /** When omitted, Y is 0–100% of peak (relative). */
  velocityUnit?: string;
  limits?: VelocityChartLimits;
  disabled?: boolean;
  compact?: boolean;
  minAccelMs?: number;
  onProfileChange?: (profile: MotionProfile) => void;
};

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 50;
const AXIS_INSET = 0.8;
const TICK_LEN = 2.2;
const KEYBOARD_STEP = 0.005;

type PhaseId = "accel" | "cruise" | "decel";
type LimitAttr = "velocity";
type TimeTickId = "accel-end" | "cruise-end" | "decel-end";

const MIN_TICK_GAP_PCT = 10;
const HANDLE_DOT_R = 3.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const plotLeft = AXIS_INSET;
const plotRight = VIEW_WIDTH - AXIS_INSET;
const plotTop = AXIS_INSET;
const plotBottom = VIEW_HEIGHT - AXIS_INSET;
const plotWidth = plotRight - plotLeft;
const plotHeight = plotBottom - plotTop;

const svgY = (vNorm: number): number => plotTop + plotHeight * (1 - vNorm);

const plotX = (tNorm: number): number => plotLeft + tNorm * plotWidth;

const formatPoint = (tNorm: number, vNorm: number): string =>
  `${plotX(tNorm)},${svgY(vNorm)}`;

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const formatSec = (ms: number): string => (ms / 1000).toFixed(2);

const plotLeftPct = `${(plotLeft / VIEW_WIDTH) * 100}%`;
const plotRightPct = `${(plotRight / VIEW_WIDTH) * 100}%`;
const plotTopPct = `${(plotTop / VIEW_HEIGHT) * 100}%`;
const plotBottomPct = `${(plotBottom / VIEW_HEIGHT) * 100}%`;
const plotWidthPct = `${(plotWidth / VIEW_WIDTH) * 100}%`;
const plotHeightPct = `${(plotHeight / VIEW_HEIGHT) * 100}%`;

const staggerTickPercents = (percents: number[]): number[] => {
  const placed: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const pct of percents) {
    const next = Math.min(100, Math.max(pct, last + MIN_TICK_GAP_PCT));
    placed.push(next);
    last = next;
  }
  return placed;
};

const drawVelocityNorm = (
  profile: MotionProfile,
  tNorm: number,
  durationMs: number,
): number => sampleVelocityNorm(profile, tNorm, durationMs);

/** sampleVelocityNorm is 0–1 of peak; scale into the plot's 0–yTop velocity axis. */
const plotNormFromSample = (
  sample: number,
  peakVelocity: number,
  yTop: number,
): number => (sample * peakVelocity) / yTop;

const PhaseShape = ({
  profile,
  durationMs,
  peakVelocity,
  yTop,
  t0,
  t1,
  phase,
  fillClass,
  limitAttr,
}: {
  profile: MotionProfile;
  durationMs: number;
  peakVelocity: number;
  yTop: number;
  t0: number;
  t1: number;
  phase: PhaseId;
  fillClass: string;
  limitAttr?: LimitAttr;
}) => {
  const v0 = drawVelocityNorm(profile, t0, durationMs);
  const v1 = drawVelocityNorm(profile, t1, durationMs);
  const y0 = svgY(plotNormFromSample(v0, peakVelocity, yTop));
  const y1 = svgY(plotNormFromSample(v1, peakVelocity, yTop));
  const points = [
    formatPoint(t0, 0),
    `${plotX(t0)},${y0}`,
    `${plotX(t1)},${y1}`,
    formatPoint(t1, 0),
  ].join(" ");
  return (
    <polygon
      points={points}
      className={fillClass}
      data-phase={phase}
      {...(limitAttr ? { "data-limit": limitAttr } : {})}
    />
  );
};

export const VelocityChart = ({
  profile,
  durationMs,
  velocityUnit,
  limits,
  disabled,
  compact = false,
  minAccelMs,
  onProfileChange,
}: VelocityChartProps) => {
  const plotRef = useRef<SVGSVGElement>(null);
  const { kind, params } = profile;
  const { accelMs, decelMs } = params;
  const cruiseMs = Math.max(0, durationMs - accelMs - decelMs);
  const tAccel = durationMs > 0 ? accelMs / durationMs : 0;
  const tCruiseEnd = durationMs > 0 ? (accelMs + cruiseMs) / durationMs : 1;
  const peakVelocity =
    limits?.peakVelocity !== undefined && limits.peakVelocity > 0
      ? limits.peakVelocity
      : 1;
  const yTop = Math.max(peakVelocity, limits?.maxVelocity ?? 0, 1e-9);
  const velocityMaxNorm =
    limits?.maxVelocity != null ? limits.maxVelocity / yTop : null;
  const velOver =
    limits != null &&
    limits.maxVelocity != null &&
    limits.peakVelocity > limits.maxVelocity;
  const meta = profileKindMeta(kind);
  const handles = meta?.handles(profile, durationMs) ?? [];
  const canDrawProfile = kind === "trapezoid" && meta != null;
  const editable = Boolean(onProfileChange) && !disabled && canDrawProfile;

  const tNormFromClientX = (clientX: number): number => {
    const svg = plotRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const innerLeft = rect.left + rect.width * (plotLeft / VIEW_WIDTH);
    const innerWidth = rect.width * (plotWidth / VIEW_WIDTH);
    if (innerWidth <= 0) return 0;
    return clamp01((clientX - innerLeft) / innerWidth);
  };

  const plotYFromT = (tNorm: number): number =>
    svgY(
      plotNormFromSample(
        drawVelocityNorm(profile, tNorm, durationMs),
        peakVelocity,
        yTop,
      ),
    );

  const handlePointerDown = (event: PointerEvent<SVGGElement>) => {
    if (!editable || !onProfileChange || !meta) return;
    const handleId = event.currentTarget.dataset.handle;
    if (!handleId) return;
    event.preventDefault();
    const apply = (clientX: number) => {
      onProfileChange(
        meta.applyHandleDrag(
          profile,
          handleId,
          tNormFromClientX(clientX),
          durationMs,
          minAccelMs,
        ),
      );
    };
    apply(event.clientX);
    const onMove = (moveEvent: globalThis.PointerEvent) => apply(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (!editable || !onProfileChange || !meta) return;
    const handleId = event.currentTarget.dataset.handle;
    if (!handleId) return;
    const delta =
      event.key === "ArrowRight" ? KEYBOARD_STEP : event.key === "ArrowLeft" ? -KEYBOARD_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    const current = handles.find((handle) => handle.id === handleId)?.tNorm ?? 0;
    onProfileChange(
      meta.applyHandleDrag(
        profile,
        handleId,
        clamp01(current + delta),
        durationMs,
        minAccelMs,
      ),
    );
  };

  const interiorTicks: Array<{ id: TimeTickId; tNorm: number; label: string }> = [
    { id: "accel-end", tNorm: tAccel, label: formatSec(accelMs) },
    { id: "cruise-end", tNorm: tCruiseEnd, label: formatSec(accelMs + cruiseMs) },
  ];
  const tickLeftPercents = staggerTickPercents(
    interiorTicks.map((tick) => (plotX(tick.tNorm) / VIEW_WIDTH) * 100),
  );
  const velocityAxisTitle = velocityUnit ? `v/(${velocityUnit})` : "v";
  const showPeakTick =
    canDrawProfile &&
    limits?.peakVelocity !== undefined &&
    limits.peakVelocity > 0;

  const maxLabel =
    limits?.maxVelocity != null ? formatNumber(limits.maxVelocity) : null;

  const tickLabelClass =
    "pointer-events-none absolute font-mono text-mono-sm tabular-nums text-muted-foreground";
  const axisTitleClass =
    "pointer-events-none absolute whitespace-nowrap font-mono text-mono-sm text-muted-foreground";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-visible px-4",
        // compact ? "pr-5" : "pr-8",
      )}
    >
      <div className="relative min-h-0 min-w-0 flex-1" aria-label="速度">
          <svg
            ref={plotRef}
            className="h-full min-h-0 min-w-0 w-full overflow-visible"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="速度-时间曲线"
          >
          <rect
            data-testid="plot-well"
            x={plotLeft}
            y={plotTop}
            width={plotWidth}
            height={plotHeight}
            className="fill-input-background"
          />
          {compact
            ? [0.25, 0.5, 0.75].map((gridNorm) => (
                <line
                  key={gridNorm}
                  x1={plotLeft}
                  y1={svgY(gridNorm)}
                  x2={plotRight}
                  y2={svgY(gridNorm)}
                  className="stroke-muted-foreground/15"
                  strokeWidth={0.4}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}
          {canDrawProfile ? (
            <>
              <PhaseShape
                profile={profile}
                durationMs={durationMs}
                peakVelocity={peakVelocity}
                yTop={yTop}
                t0={0}
                t1={tAccel}
                phase="accel"
                fillClass="fill-primary/20"
              />
              <PhaseShape
                profile={profile}
                durationMs={durationMs}
                peakVelocity={peakVelocity}
                yTop={yTop}
                t0={tAccel}
                t1={tCruiseEnd}
                phase="cruise"
                fillClass={velOver ? "fill-warning/25" : "fill-primary/20"}
                limitAttr={velOver ? "velocity" : undefined}
              />
              <PhaseShape
                profile={profile}
                durationMs={durationMs}
                peakVelocity={peakVelocity}
                yTop={yTop}
                t0={tCruiseEnd}
                t1={1}
                phase="decel"
                fillClass="fill-primary/20"
              />
              <polyline
                fill="none"
                className="stroke-primary"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                points={[
                  formatPoint(0, 0),
                  `${plotX(tAccel)},${plotYFromT(tAccel)}`,
                ].join(" ")}
              />
              <line
                x1={plotX(tAccel)}
                y1={plotYFromT(tAccel)}
                x2={plotX(tCruiseEnd)}
                y2={plotYFromT(tCruiseEnd)}
                className={velOver ? "stroke-warning" : "stroke-primary"}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                fill="none"
                className="stroke-primary"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                points={[
                  `${plotX(tCruiseEnd)},${plotYFromT(tCruiseEnd)}`,
                  formatPoint(1, 0),
                ].join(" ")}
              />
              {showPeakTick ? (
                <line
                  data-testid="peak-tick"
                  x1={plotX((tAccel + tCruiseEnd) / 2) - 1.6}
                  x2={plotX((tAccel + tCruiseEnd) / 2) + 1.6}
                  y1={plotYFromT((tAccel + tCruiseEnd) / 2)}
                  y2={plotYFromT((tAccel + tCruiseEnd) / 2)}
                  className="stroke-foreground"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </>
          ) : null}
          {velocityMaxNorm != null ? (
            <line
              data-testid="velocity-limit"
              x1={plotLeft}
              y1={svgY(velocityMaxNorm)}
              x2={plotRight}
              y2={svgY(velocityMaxNorm)}
              className="stroke-warning/70"
              strokeWidth={0.4}
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {velocityMaxNorm != null ? (
            <line
              x1={plotLeft}
              y1={svgY(velocityMaxNorm)}
              x2={plotLeft + TICK_LEN}
              y2={svgY(velocityMaxNorm)}
              className="stroke-foreground"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <line
            x1={plotLeft}
            y1={plotBottom}
            x2={plotLeft + TICK_LEN}
            y2={plotBottom}
            className="stroke-foreground"
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
          {velocityMaxNorm != null ? (
            <line
              x1={plotRight - TICK_LEN}
              y1={svgY(velocityMaxNorm)}
              x2={plotRight}
              y2={svgY(velocityMaxNorm)}
              className="stroke-foreground"
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {editable
            ? handles.map((handle) => {
                const x = plotX(handle.tNorm);
                return (
                  <g
                    key={handle.id}
                    role="slider"
                    aria-label={handle.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(handle.tNorm * 100)}
                    data-handle={handle.id}
                    tabIndex={0}
                    className="cursor-ew-resize"
                    onPointerDown={handlePointerDown}
                    onKeyDown={handleKeyDown}
                  >
                    <line
                      x1={x}
                      y1={plotTop}
                      x2={x}
                      y2={plotBottom}
                      className="stroke-muted-foreground"
                      strokeWidth={0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={x}
                      cy={plotYFromT(handle.tNorm)}
                      r={HANDLE_DOT_R}
                      className="fill-primary stroke-background"
                      strokeWidth={0.8}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })
            : null}
          </svg>
          <div
            data-testid="axis-velocity"
            className="pointer-events-none absolute"
            style={{
              left: plotLeftPct,
              top: plotTopPct,
              height: plotHeightPct,
              width: 0,
            }}
          >
            <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-foreground" />
            <span
              data-testid="axis-velocity-arrow"
              className="absolute left-0 top-0 h-0 w-0 -translate-x-1/2 border-x-4 border-b-[7px] border-solid border-x-transparent border-b-foreground"
              aria-hidden
            />
            <span
              data-testid="axis-velocity-title"
              className={`${axisTitleClass} left-0 top-0 translate-x-2`}
            >
              {velocityAxisTitle}
            </span>
          </div>
          <div
            data-testid="axis-time"
            className="pointer-events-none absolute"
            style={{
              left: plotLeftPct,
              top: plotBottomPct,
              width: plotWidthPct,
              height: 0,
            }}
          >
            <span className="absolute inset-x-0 top-0 h-px -translate-y-1/2 bg-foreground" />
            <span
              data-testid="axis-time-arrow"
              className="absolute top-0 left-full h-0 w-0 -translate-y-1/2 border-y-4 border-l-[7px] border-solid border-y-transparent border-l-foreground"
              aria-hidden
            />
            <span
              data-testid="axis-time-title"
              className={`${axisTitleClass} top-0 left-full -translate-y-[calc(100%+2px)] -translate-x-4`}
            >
              t/s
            </span>
          </div>
          <span
            data-testid="velocity-zero"
            className={tickLabelClass}
            style={{
              left: plotLeftPct,
              top: plotBottomPct,
              transform: "translate(calc(-100% - 4px), -50%)",
            }}
          >
            0
          </span>
          {maxLabel != null && velocityMaxNorm != null ? (
            <span
              data-testid="velocity-max"
              className={cn(tickLabelClass, "text-warning")}
              style={{
                left: `${(((plotLeft + plotRight) / 2) / VIEW_WIDTH) * 100}%`,
                top: `${(svgY(velocityMaxNorm) / VIEW_HEIGHT) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {maxLabel}
            </span>
          ) : null}
      </div>
      <div className="relative h-5 shrink-0 min-w-0" aria-label="时间">
          {interiorTicks.map((tick, index) => (
            <span
              key={tick.id}
              data-testid="time-tick"
              data-tick={tick.id}
              className={tickLabelClass}
              style={{
                left: `${tickLeftPercents[index] ?? 0}%`,
                top: 0,
                transform: "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          ))}
      </div>
    </div>
  );
};
