import { useMemo } from "react";
import { fitCurveScales, type AxisCurve, type CurveGraph } from "./curve-data";
import { buildCurvePaths, plotY, SAMPLE_PX } from "./timeline-curves";
import { TIMELINE_PAD_LEFT } from "./timeline-data";
import { viewPxFromMs } from "./timeline-view-extent";

/** 底图按 0–1000 的高度画，横向就是像素；上下各留一点，曲线不贴边 */
const UNDERLAY_HEIGHT = 1000;
const UNDERLAY_PLOT = { top: 60, height: 880 };

const noIssueText = () => "";

/**
 * 轨道视图的曲线底图：只选了一个物体时，把它这根虚轴的位置或速度曲线淡淡地铺在整个轨道区背后，
 * 和轨道上的位姿对着时间看。只看不点，按下都落到轨道上；超限、算不出来的段用警告色。
 */
export const TrackCurveUnderlay = ({
  curve,
  graph,
  canvasWidth,
  viewStartMs,
  viewEndMs,
  pxPerSecond,
}: {
  curve: AxisCurve;
  graph: CurveGraph;
  canvasWidth: number;
  viewStartMs: number;
  viewEndMs: number;
  pxPerSecond: number;
}) => {
  const range = useMemo(() => fitCurveScales([curve])[graph], [curve, graph]);
  const y = (value: number) => plotY(UNDERLAY_PLOT, range, value);

  const paths = useMemo(() => {
    const stepMs = (SAMPLE_PX / pxPerSecond) * 1000;
    return buildCurvePaths(
      curve,
      {
        graph,
        x: (atMs) => TIMELINE_PAD_LEFT + viewPxFromMs(atMs, viewStartMs, pxPerSecond),
        y: (value) => plotY(UNDERLAY_PLOT, range, value),
        fromMs: Math.max(0, viewStartMs - stepMs),
        toMs: viewEndMs + stepMs,
        stepMs,
      },
      noIssueText,
      noIssueText,
    );
  }, [curve, graph, range, viewStartMs, viewEndMs, pxPerSecond]);

  return (
    <div
      data-testid="track-curve-underlay"
      data-object-id={String(curve.objectId)}
      data-graph={graph}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <svg
        className="absolute left-0 top-0 h-full"
        width={canvasWidth}
        viewBox={`0 0 ${canvasWidth} ${UNDERLAY_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {graph === "velocity" ? (
          <line
            x1={0}
            x2={canvasWidth}
            y1={y(0)}
            y2={y(0)}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            className="stroke-border"
          />
        ) : null}
        <path
          data-testid="track-curve-underlay-line"
          d={paths.line}
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="stroke-primary/45"
        />
        {paths.issues.map((issue, index) => (
          <path
            key={index}
            d={issue.d}
            fill="none"
            strokeWidth={2}
            strokeDasharray={issue.dashed ? "5 4" : undefined}
            vectorEffect="non-scaling-stroke"
            className="stroke-warning/60"
          />
        ))}
      </svg>
    </div>
  );
};
