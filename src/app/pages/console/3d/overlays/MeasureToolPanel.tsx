import { useEffect, useState } from "react";
import { Eraser, Magnet, Trash2 } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { formatMeasureLength, type MeasureState } from "@/app/viz3d";
import { useViz3DContext } from "../Viz3DProvider";

/** 分量颜色与属性表单的 X / Y / Z 一致 */
const DELTA_AXES = [
  { axis: "x", letter: "X", color: "var(--destructive)" },
  { axis: "y", letter: "Y", color: "var(--show)" },
  { axis: "z", letter: "Z", color: "var(--primary)" },
] as const;

const ACTION_BTN =
  "inline-flex h-7 items-center gap-1 rounded-sm px-2 text-body-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3 [&_svg]:size-4";

const useMeasureState = (): MeasureState => {
  const engine = useViz3DContext();
  const [state, setState] = useState<MeasureState>(() => engine.getMeasureState());
  useEffect(() => {
    setState(engine.getMeasureState());
    engine.events.on("measureChange", setState);
    return () => {
      engine.events.off("measureChange", setState);
    };
  }, [engine]);
  return state;
};

/**
 * 测量工具面板（左下角，不挡视图中间）：选中标尺的长度与 X / Y / Z 分量，顶点吸附开关，删除 / 全部清除。
 */
export const MeasureToolPanel = ({
  onPointerGuard,
}: {
  onPointerGuard: (event: { stopPropagation(): void }) => void;
}) => {
  const engine = useViz3DContext();
  const unit = useSessionDisplayLengthUnit();
  const state = useMeasureState();
  const selected = state.rulers.find((ruler) => ruler.id === state.selectedId) ?? null;

  return (
    <div
      role="region"
      aria-label="测量"
      onPointerDown={onPointerGuard}
      className="pointer-events-auto absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-md bg-card px-3 py-2 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1" aria-live="polite">
        {selected ? (
          <>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-body-sm text-muted-foreground">长度</span>
              <span className="font-mono text-body-sm font-semibold tabular-nums text-foreground">
                {formatMeasureLength(selected.lengthMm, unit)}
              </span>
            </span>
            {DELTA_AXES.map(({ axis, letter, color }) => (
              <span key={axis} className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-body-sm" style={{ color }}>
                  {letter}
                </span>
                <span className="font-mono text-body-sm tabular-nums text-foreground">
                  {formatMeasureLength(selected.deltaMm[axis], unit)}
                </span>
              </span>
            ))}
          </>
        ) : (
          <span className="text-body-sm text-muted-foreground">
            {state.rulers.length === 0 ? "按住左键拖动，画一条标尺" : "点标尺选中，拖端点修改"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-pressed={state.snapVertices}
          onClick={() => engine.setMeasureSnapVertices(!state.snapVertices)}
          className={cn(ACTION_BTN, state.snapVertices ? "text-primary" : "text-muted-foreground")}
        >
          <Magnet aria-hidden />
          吸附顶点
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => engine.deleteSelectedMeasurement()}
          className={cn(ACTION_BTN, "text-foreground")}
        >
          <Trash2 aria-hidden />
          删除
        </button>
        <button
          type="button"
          disabled={state.rulers.length === 0}
          onClick={() => engine.clearMeasurements()}
          className={cn(ACTION_BTN, "text-foreground")}
        >
          <Eraser aria-hidden />
          全部清除
        </button>
        <span className="ml-1 text-xs text-muted-foreground">靠近吊点自动吸附 · Ctrl 临时切换顶点吸附</span>
      </div>
    </div>
  );
};
