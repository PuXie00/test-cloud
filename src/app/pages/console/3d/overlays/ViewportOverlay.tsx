import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Clapperboard,
  LayoutGrid,
  Locate,
  MousePointer2,
  Move,
  Rotate3d,
  Ruler,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import type { ToolMode } from "@/app/viz3d";
import { pendingGoEntries } from "../../hooks/go-ready";
import { useGoReady } from "../../hooks/go-ready-provider";
import { useSequencePreview } from "../../hooks/sequence-preview-provider";
import { useConsoleNav } from "../../hooks/use-console-nav";
import { useControlLayout } from "../../hooks/use-control-layout";
import { setLivePoseHold, useLivePoseHold } from "../live-pose-hold";
import { useViz3DContext } from "../Viz3DProvider";
import { SequencePreviewBar } from "./sequence-preview-bar";
import { ShapePresetPalette } from "./ShapePresetPalette";
import { ViewMenu } from "./ViewMenu";

const MODE_BUTTONS: { mode: ToolMode; icon: LucideIcon; label: string }[] = [
  { mode: "select", icon: MousePointer2, label: "选择" },
  { mode: "translate", icon: Move, label: "平移" },
  { mode: "rotate", icon: Rotate3d, label: "旋转" },
  { mode: "measure", icon: Ruler, label: "测量" },
];

const MODE_GROUP_CLASS =
  "pointer-events-auto flex flex-col overflow-hidden rounded-md";

const MODE_ICON_BTN =
  "flex h-10 w-10 items-center justify-center transition-colors [&_svg]:size-4";

const PANEL_TOGGLE_BTN =
  "inline-flex h-7 px-1 gap-0.5 items-center justify-center rounded-sm transition-colors hover:bg-accent [&_svg]:size-4";

const ViewportGoControls = () => {
  const { state, go, cancel } = useGoReady();
  if (state.phase === "idle") return null;

  const canGoAll = pendingGoEntries(state.entries).length > 0;
  const handleGoAll = () => {
    void go();
  };
  const handleCancelAll = () => {
    cancel();
  };

  return (
    <div className="flex items-center gap-1" aria-label="全部物体 GO">
      <button
        type="button"
        aria-label="全部物体 GO"
        title="全部物体 GO"
        disabled={!canGoAll}
        onClick={handleGoAll}
        className="h-7 rounded-sm bg-primary px-2.5 text-body-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        GO
      </button>
      <button
        type="button"
        aria-label="取消全部 GO"
        title="取消全部 GO"
        onClick={handleCancelAll}
        className="h-7 rounded-sm border border-primary px-2.5 text-body-sm text-primary hover:bg-primary/10"
      >
        清除
      </button>
    </div>
  );
};

const ControlPanelToggles = () => {
  const {
    monitorPanelVisible,
    rightPanelVisible,
    programPanelVisible,
    toggleMonitorPanel,
    toggleRightPanel,
    toggleProgramPanel,
  } = useControlLayout();

  const toggles = [
    {
      id: "monitor",
      icon: LayoutGrid,
      label: "监控",
      pressed: monitorPanelVisible,
      onToggle: toggleMonitorPanel,
    },
    {
      id: "operate",
      icon: SlidersHorizontal,
      label: "操作",
      pressed: rightPanelVisible,
      onToggle: toggleRightPanel,
    },
    {
      id: "program",
      icon: Clapperboard,
      label: "节目",
      pressed: programPanelVisible,
      onToggle: toggleProgramPanel,
    },
  ] as const;

  return (
    <div className="flex items-center gap-0.5" aria-label="控制面板">
      {toggles.map(({ id, icon: Icon, label, pressed, onToggle }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={pressed}
          onClick={onToggle}
          className={cn(
            PANEL_TOGGLE_BTN,
            pressed ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Icon aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
};

const LivePoseHoldButton = () => {
  const holding = useLivePoseHold();

  useEffect(() => () => setLivePoseHold(false), []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLivePoseHold(true);
  };

  const handlePointerEnd = () => {
    setLivePoseHold(false);
  };

  return (
    <button
      type="button"
      aria-label="显示当前位置"
      title="按住显示当前位置"
      aria-pressed={holding}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(PANEL_TOGGLE_BTN, holding ? "text-primary" : "text-muted-foreground")}
    >
      <Locate aria-hidden />
      当前位置
    </button>
  );
};

export const ViewportOverlay = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const preview = useSequencePreview();
  const showToolMode = activeNav === "devices";
  const isControl = activeNav === "control";
  const isSequences = activeNav === "sequences";
  const [mode, setMode] = useState<ToolMode>(() => engine.getMode());

  useEffect(() => {
    const handleMode = (next: ToolMode) => setMode(next);
    engine.events.on("modeChange", handleMode);
    return () => {
      engine.events.off("modeChange", handleMode);
    };
  }, [engine]);

  const stopPointer = (event: { stopPropagation(): void }) => {
    event.stopPropagation();
  };

  const handleMode = (next: ToolMode) => engine.setMode(next);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-md">
      {showToolMode && (
        <>
          <div
            onPointerDown={stopPointer}
            className="pointer-events-auto absolute left-3 top-1/2 flex -translate-y-1/2 flex-col"
            aria-label="工具模式"
          >
            <div className={MODE_GROUP_CLASS}>
              {MODE_BUTTONS.map(({ mode: value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={mode === value}
                  onPointerDown={stopPointer}
                  onClick={() => handleMode(value)}
                  style={{
                    backgroundColor: mode === value ? "var(--primary)" : "rgba(167, 164, 163, 0.14)",
                  }}
                  className={cn(
                    MODE_ICON_BTN,
                    "text-foreground",
                  )}
                >
                  <Icon aria-hidden />
                </button>
              ))}
            </div>
          </div>
          <ShapePresetPalette />
        </>
      )}

      <div
        onPointerDown={stopPointer}
        className="pointer-events-auto flex items-center justify-between px-2 py-1"
        style={{
          backgroundColor: "rgba(167, 164, 163, 0.14)",
        }}
      >
        <ViewMenu onPointerGuard={stopPointer} />
        {isControl ? (
          <div className="ml-auto flex items-center gap-2">
            <ViewportGoControls />
            <ControlPanelToggles />
          </div>
        ) : null}
        {isSequences ? (
          <div className="ml-auto">
            <LivePoseHoldButton />
          </div>
        ) : null}
      </div>
      {isControl && preview.sequenceId !== null && !preview.holdMode ? <SequencePreviewBar /> : null}
    </div>
  );
};
