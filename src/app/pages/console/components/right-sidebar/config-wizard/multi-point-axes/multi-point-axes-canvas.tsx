import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import {
  formatLengthFamily,
  formatLengthFamilyValue,
  getDisplayLengthFamilyUnit,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import { viz3dAxisCssColor } from "@/app/viz3d/helpers/axes-config";
import type { AxisDefinition, AxisMount, ControlledObject } from "../config-wizard-types";
import { CIRCLE_CHORD_ERROR_WARN_MM } from "./multi-point-axes-circle-layout";
import {
  buildClosedAxisEdges,
  createAutoFitBounds,
  createShapeFootprint,
  type Point2D,
  type ShapeFootprint,
} from "./multi-point-axes-geometry";

export type MultiPointAxesBackgroundImage = {
  href: string;
  boundsMm: { minX: number; maxX: number; minZ: number; maxZ: number };
};

export type MultiPointAxesCanvasProps = {
  object: Pick<ControlledObject, "shapePreset" | "shapeDimensions" | "dimensions">;
  axes: readonly AxisDefinition[];
  safetyRadius: number;
  initialTiltDirection: number;
  selectedAxisKey: string | null;
  boundAxisKeys: ReadonlySet<string>;
  invalidAxisKeys: ReadonlySet<string>;
  /** Optional offscreen top-view PNG; visual reference only. */
  backgroundImage?: MultiPointAxesBackgroundImage | null;
  /** 圆形布局时禁拖与键盘微调 */
  mountsEditable?: boolean;
  /** 圆形布局参考圆半径（mm）；>0 时绘制 */
  layoutCircleRadiusMm?: number | null;
  /** 圆形布局弦长总绝对误差（mm）；有值时在左下角显示 */
  totalChordErrorMm?: number | null;
  onSelectedAxisChange: (axisKey: string) => void;
  onAxisMountChange: (axisKey: string, mount: AxisMount) => void;
};

const AXIS_NODE_RADIUS_MM = 40;
const AXIS_NODE_LABEL_FONT_SIZE_MM = 38;
const AXIS_NODE_LABEL_STROKE_WIDTH_MM = 6;
const DISTANCE_LABEL_FONT_SIZE_MM = 32;
const DISTANCE_LABEL_HEIGHT_MM = 44;
const DISTANCE_LABEL_CHAR_WIDTH_MM = 20;
const DISTANCE_LABEL_MIN_WIDTH_MM = 140;
const DISTANCE_LABEL_RX_MM = 6;
const COORD_AXIS_OPACITY = 0.45;
const COORD_AXIS_LABEL_FONT_SIZE_MM = 48;

/**
 * Align SVG with 3D top view (camera up = -Z, screen-right = -X):
 * model (+X,+Z) → SVG left / down.
 */
const toSvgPoint = ({ x, z }: Point2D) => ({ x: -x, y: z });

const boundsToViewBox = (bounds: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}): string =>
  `${-bounds.maxX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`;

const clientToModelPoint = (
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): AxisMount | null => {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: -point.x, z: point.y };
};

const axisAriaLabel = (
  index: number,
  mount: AxisMount,
  bound: boolean,
  invalid: boolean,
  display: DisplayLengthUnit,
): string => {
  const binding = bound ? "已绑定" : "未绑定";
  const validity = invalid ? "越界" : "有效";
  const unitSuffix = getDisplayLengthFamilyUnit("mm", display);
  const xText = formatLengthFamilyValue(mount.x, "mm", display, { canonicalPrecision: 0 });
  const zText = formatLengthFamilyValue(mount.z, "mm", display, { canonicalPrecision: 0 });
  return `吊点 ${index + 1}，X ${xText} ${unitSuffix}，Z ${zText} ${unitSuffix}，${binding}，${validity}`;
};

const FootprintShape = ({
  footprint,
  faded = false,
}: {
  footprint: ShapeFootprint;
  faded?: boolean;
}) => {
  const common = {
    "data-testid": "object-footprint",
    className: faded ? "fill-none stroke-border/80" : "fill-muted/40 stroke-border",
    vectorEffect: "non-scaling-stroke" as const,
    strokeWidth: 1,
  };

  switch (footprint.kind) {
    case "rectangle": {
      const width = footprint.halfWidth * 2;
      const height = footprint.halfDepth * 2;
      return (
        <rect
          {...common}
          x={-footprint.halfWidth}
          y={-footprint.halfDepth}
          width={width}
          height={height}
        />
      );
    }
    case "circle":
      if (footprint.innerRadius !== undefined) {
        const outer = footprint.outerRadius;
        const inner = footprint.innerRadius;
        return (
          <path
            {...common}
            fillRule="evenodd"
            d={`M ${-outer} 0 A ${outer} ${outer} 0 1 0 ${outer} 0 A ${outer} ${outer} 0 1 0 ${-outer} 0 Z M ${-inner} 0 A ${inner} ${inner} 0 1 1 ${inner} 0 A ${inner} ${inner} 0 1 1 ${-inner} 0 Z`}
          />
        );
      }
      return <circle {...common} cx={0} cy={0} r={footprint.outerRadius} />;
    case "squareRing": {
      const ow = footprint.halfWidth * 2;
      const oh = footprint.halfDepth * 2;
      const iw = footprint.innerHalfWidth * 2;
      const ih = footprint.innerHalfDepth * 2;
      return (
        <path
          {...common}
          fillRule="evenodd"
          d={`M ${-footprint.halfWidth} ${-footprint.halfDepth} h ${ow} v ${oh} h ${-ow} Z M ${-footprint.innerHalfWidth} ${-footprint.innerHalfDepth} h ${iw} v ${ih} h ${-iw} Z`}
        />
      );
    }
    case "polygon": {
      const points = footprint.points.map((point) => {
        const svg = toSvgPoint(point);
        return `${svg.x},${svg.y}`;
      }).join(" ");
      return <polygon {...common} points={points} />;
    }
    default:
      return null;
  }
};

type ActiveDrag = {
  pointerId: number;
  axisKey: string;
};

export const MultiPointAxesCanvas = ({
  object,
  axes,
  safetyRadius,
  initialTiltDirection,
  selectedAxisKey,
  boundAxisKeys,
  invalidAxisKeys,
  backgroundImage = null,
  mountsEditable = true,
  layoutCircleRadiusMm = null,
  totalChordErrorMm = null,
  onSelectedAxisChange,
  onAxisMountChange,
}: MultiPointAxesCanvasProps) => {
  const display = useSessionDisplayLengthUnit();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [frozenViewBox, setFrozenViewBox] = useState<string | null>(null);
  const layoutRadius =
    typeof layoutCircleRadiusMm === "number" &&
    Number.isFinite(layoutCircleRadiusMm) &&
    layoutCircleRadiusMm > 0
      ? layoutCircleRadiusMm
      : 0;

  const footprint = useMemo(() => createShapeFootprint(object), [object]);
  const edges = useMemo(() => buildClosedAxisEdges(axes), [axes]);
  const fittedBounds = useMemo(
    () => createAutoFitBounds(footprint, safetyRadius, axes, layoutRadius),
    [footprint, safetyRadius, axes, layoutRadius],
  );
  const fittedViewBox = useMemo(() => boundsToViewBox(fittedBounds), [fittedBounds]);
  const viewBox = frozenViewBox ?? fittedViewBox;
  const isApproximate =
    footprint.kind === "rectangle" && footprint.approximate === true;

  const handlePointerDown = useCallback(
    (axisKey: string, event: ReactPointerEvent<SVGGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectedAxisChange(axisKey);
      if (!mountsEditable || !svgRef.current) return;

      // Ref first so a nested/synchronous pointermove cannot race a stale null.
      activeDragRef.current = { pointerId: event.pointerId, axisKey };
      setFrozenViewBox(fittedViewBox);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [fittedViewBox, mountsEditable, onSelectedAxisChange],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const activeDrag = activeDragRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const svg = svgRef.current;
      if (!svg) return;
      const point = clientToModelPoint(svg, event.clientX, event.clientY);
      if (!point) return;
      onAxisMountChange(activeDrag.axisKey, point);
    },
    [onAxisMountChange],
  );

  const clearDrag = useCallback(
    (event: ReactPointerEvent<SVGSVGElement | SVGGElement>) => {
      const activeDrag = activeDragRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const target = event.currentTarget;
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      activeDragRef.current = null;
      setFrozenViewBox(null);
    },
    [],
  );

  const handleAxisKeyDown = useCallback(
    (axis: AxisDefinition, event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        onSelectedAxisChange(axis.key);
        event.preventDefault();
        return;
      }

      if (!mountsEditable) return;

      const stepMm = event.shiftKey ? 10 : 1;
      let next: AxisMount | null = null;

      // Match on-screen direction (top-view: right=-X, up=-Z).
      switch (event.key) {
        case "ArrowRight":
          next = { x: axis.mount.x - stepMm, z: axis.mount.z };
          break;
        case "ArrowLeft":
          next = { x: axis.mount.x + stepMm, z: axis.mount.z };
          break;
        case "ArrowUp":
          next = { x: axis.mount.x, z: axis.mount.z - stepMm };
          break;
        case "ArrowDown":
          next = { x: axis.mount.x, z: axis.mount.z + stepMm };
          break;
        default:
          return;
      }

      event.preventDefault();
      onSelectedAxisChange(axis.key);
      onAxisMountChange(axis.key, next);
    },
    [mountsEditable, onAxisMountChange, onSelectedAxisChange],
  );

  // Direction indicator sits in the lower-right of the fitted bounds (screen space).
  const directionOrigin = useMemo(() => {
    const insetX = (fittedBounds.maxX - fittedBounds.minX) * 0.12;
    const insetZ = (fittedBounds.maxZ - fittedBounds.minZ) * 0.12;
    return {
      x: fittedBounds.minX + insetX,
      z: fittedBounds.maxZ - insetZ,
    };
  }, [fittedBounds]);
  const directionSvg = toSvgPoint(directionOrigin);
  // Bounds are in mm; do not cap to a sub-millimetre length (arrow would vanish).
  const arrowLength = Math.min(
    (fittedBounds.maxX - fittedBounds.minX) * 0.08,
    (fittedBounds.maxZ - fittedBounds.minZ) * 0.08,
  );
  const coordXStart = toSvgPoint({ x: fittedBounds.minX, z: 0 });
  const coordXEnd = toSvgPoint({ x: fittedBounds.maxX, z: 0 });
  const coordZStart = toSvgPoint({ x: 0, z: fittedBounds.minZ });
  const coordZEnd = toSvgPoint({ x: 0, z: fittedBounds.maxZ });
  const coordArrowSize = Math.min(
    (fittedBounds.maxX - fittedBounds.minX) * 0.035,
    (fittedBounds.maxZ - fittedBounds.minZ) * 0.035,
    80,
  );
  const coordLabelOffset = coordArrowSize * 1.4;
  // +X → SVG left; +Z → SVG down — label inset toward origin from tip
  const coordXLabel = {
    x: coordXEnd.x + coordLabelOffset,
    y: coordXEnd.y - coordArrowSize * 0.6,
  };
  const coordZLabel = {
    x: coordZEnd.x - coordArrowSize * 0.6,
    y: coordZEnd.y - coordLabelOffset,
  };
  const coordXColor = viz3dAxisCssColor("x", COORD_AXIS_OPACITY);
  const coordZColor = viz3dAxisCssColor("z", COORD_AXIS_OPACITY);

  const showTotalError =
    typeof totalChordErrorMm === "number" && Number.isFinite(totalChordErrorMm);
  const totalErrorWarn =
    showTotalError && totalChordErrorMm > CIRCLE_CHORD_ERROR_WARN_MM;

  return (
    <div className="relative h-full min-h-0 w-full bg-canvas">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerUp={clearDrag}
        onPointerCancel={clearDrag}
      >
        {/* 1. canvas background */}
        <rect
          x={-fittedBounds.maxX}
          y={fittedBounds.minZ}
          width={fittedBounds.maxX - fittedBounds.minX}
          height={fittedBounds.maxZ - fittedBounds.minZ}
          className="fill-canvas"
        />

        {/* 2. optional offscreen top-view reference */}
        {backgroundImage ? (
          <image
            data-testid="object-top-view-background"
            href={backgroundImage.href}
            x={-backgroundImage.boundsMm.maxX}
            y={backgroundImage.boundsMm.minZ}
            width={backgroundImage.boundsMm.maxX - backgroundImage.boundsMm.minX}
            height={backgroundImage.boundsMm.maxZ - backgroundImage.boundsMm.minZ}
            preserveAspectRatio="none"
            pointerEvents="none"
            opacity={0.9}
          />
        ) : null}

        {/* 3. safety range */}
        <circle
          data-testid="safety-range"
          cx={0}
          cy={0}
          r={safetyRadius}
          className="fill-warning-surface stroke-warning"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
        />

        {/* 3b. mount layout circle (circle mode) */}
        {layoutRadius > 0 ? (
          <circle
            data-testid="layout-circle"
            cx={0}
            cy={0}
            r={layoutRadius}
            className="fill-none stroke-primary"
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.5}
          />
        ) : null}

        {/* 4. object footprint */}
        <FootprintShape footprint={footprint} faded={Boolean(backgroundImage)} />

        {/* 4b. model X/Z axes — full view, dashed, arrowed; colors match 3D helper */}
        <g data-testid="coord-axes" pointerEvents="none">
          <line
            x1={coordXStart.x}
            y1={coordXStart.y}
            x2={coordXEnd.x}
            y2={coordXEnd.y}
            stroke={coordXColor}
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.25}
          />
          <polygon
            points={`0,0 ${coordArrowSize * 0.7},${coordArrowSize * 0.35} ${coordArrowSize * 0.7},${-coordArrowSize * 0.35}`}
            transform={`translate(${coordXEnd.x} ${coordXEnd.y})`}
            fill={coordXColor}
          />
          <text
            x={coordXLabel.x}
            y={coordXLabel.y}
            fill={coordXColor}
            textAnchor="middle"
            dominantBaseline="central"
            className="font-mono font-semibold"
            style={{ fontSize: COORD_AXIS_LABEL_FONT_SIZE_MM }}
          >
            X
          </text>
          <line
            x1={coordZStart.x}
            y1={coordZStart.y}
            x2={coordZEnd.x}
            y2={coordZEnd.y}
            stroke={coordZColor}
            strokeDasharray="8 6"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.25}
          />
          <polygon
            points={`0,0 ${-coordArrowSize * 0.35},${-coordArrowSize * 0.7} ${coordArrowSize * 0.35},${-coordArrowSize * 0.7}`}
            transform={`translate(${coordZEnd.x} ${coordZEnd.y})`}
            fill={coordZColor}
          />
          <text
            x={coordZLabel.x}
            y={coordZLabel.y}
            fill={coordZColor}
            textAnchor="middle"
            dominantBaseline="central"
            className="font-mono font-semibold"
            style={{ fontSize: COORD_AXIS_LABEL_FONT_SIZE_MM }}
          >
            Z
          </text>
        </g>

        {/* 5. closed edges */}
        {edges.map((edge) => {
          const from = toSvgPoint(edge.from);
          const to = toSvgPoint(edge.to);
          return (
            <line
              key={`${edge.fromKey}-${edge.toKey}`}
              data-testid="closed-edge"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="stroke-muted-foreground"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1}
            />
          );
        })}

        {/* 5. distance labels — display units only; geometry stays canonical mm */}
        {edges.map((edge) => {
          const mid = toSvgPoint(edge.midpoint);
          const label = formatLengthFamily(edge.distanceMm, "mm", display, {
            canonicalPrecision: 0,
          });
          const labelWidth = Math.max(
            DISTANCE_LABEL_MIN_WIDTH_MM,
            label.length * DISTANCE_LABEL_CHAR_WIDTH_MM,
          );
          return (
            <g key={`label-${edge.fromKey}-${edge.toKey}`} data-testid="distance-label">
              <rect
                x={mid.x - labelWidth / 2}
                y={mid.y - DISTANCE_LABEL_HEIGHT_MM / 2}
                width={labelWidth}
                height={DISTANCE_LABEL_HEIGHT_MM}
                rx={DISTANCE_LABEL_RX_MM}
                className="fill-card"
              />
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground font-mono"
                style={{ fontSize: DISTANCE_LABEL_FONT_SIZE_MM }}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* 6. axis nodes */}
        {axes.map((axis, index) => {
          const point = toSvgPoint(axis.mount);
          const selected = axis.key === selectedAxisKey;
          const bound = boundAxisKeys.has(axis.key);
          const invalid = invalidAxisKeys.has(axis.key);
          const fillClass = invalid
            ? "fill-warning"
            : bound
              ? "fill-show"
              : "fill-accent";
          const strokeClass = invalid
            ? "stroke-warning"
            : bound
              ? "stroke-show"
              : "stroke-border";

          return (
            <g
              key={axis.key}
              role="button"
              tabIndex={0}
              aria-label={axisAriaLabel(index, axis.mount, bound, invalid, display)}
              aria-pressed={selected}
              transform={`translate(${point.x} ${point.y})`}
              className={cn(
                "outline-none focus-visible:outline-1 focus-visible:outline-ring",
                mountsEditable ? "cursor-pointer" : "cursor-default",
              )}
              onPointerDown={(event) => handlePointerDown(axis.key, event)}
              onPointerUp={clearDrag}
              onPointerCancel={clearDrag}
              onKeyDown={(event) => handleAxisKeyDown(axis, event)}
              onClick={() => onSelectedAxisChange(axis.key)}
            >
              <circle
                r={AXIS_NODE_RADIUS_MM}
                className={`${fillClass} ${strokeClass}`}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1}
              />
              {/* 编号置于节点最上：白色大字 + 深描边，避免被底色淹没 */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                className="pointer-events-none fill-white stroke-canvas font-mono font-semibold"
                style={{
                  fontSize: AXIS_NODE_LABEL_FONT_SIZE_MM,
                  paintOrder: "stroke",
                  strokeWidth: AXIS_NODE_LABEL_STROKE_WIDTH_MM,
                }}
              >
                {index + 1}
              </text>
            </g>
          );
        })}

        {/* 7. direction indicator */}
        <g
          data-testid="direction-indicator"
          transform={`translate(${directionSvg.x} ${directionSvg.y}) rotate(${180 + initialTiltDirection})`}
        >
          <circle
            r={arrowLength * 0.35}
            className="fill-none stroke-secondary"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={-arrowLength}
            className="stroke-secondary"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.5}
          />
          <polygon
            points={`0,${-arrowLength} ${-arrowLength * 0.18},${-arrowLength * 0.7} ${arrowLength * 0.18},${-arrowLength * 0.7}`}
            className="fill-secondary"
          />
        </g>

        {/* 8. external approximation label */}
        {isApproximate ? (
          <text
            x={0}
            y={fittedBounds.minZ + (fittedBounds.maxZ - fittedBounds.minZ) * 0.06}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 0.04 }}
          >
            外部模型轮廓近似
          </text>
        ) : null}
      </svg>

      {showTotalError ? (
        <div
          data-testid="circle-total-error"
          className={cn(
            "pointer-events-none absolute bottom-3 left-3 rounded-md bg-muted/90 px-2 py-1",
            "font-mono text-mono-sm tabular-nums",
            totalErrorWarn ? "text-warning" : "text-muted-foreground",
          )}
          aria-label={`总误差 ${Math.round(totalChordErrorMm!)} 毫米`}
        >
          总误差 {Math.round(totalChordErrorMm!)} mm
        </div>
      ) : null}
    </div>
  );
};
