import { useEffect, useState } from "react";
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
import { useProject } from "@/app/project/use-project";
import type { ToolMode, ViewportState } from "@/app/viz3d";
import { useSetupEditState } from "../../hooks/axis-motion";
import { pendingGoEntries } from "../../hooks/go-ready";
import { useGoReady } from "../../hooks/go-ready-provider";
import { useSequencePreview } from "../../hooks/use-sequence-preview";
import { useConsoleMode } from "../../hooks/use-console-mode";
import { useConsoleNav } from "../../hooks/use-console-nav";
import { useControlLayout } from "../../hooks/use-control-layout";
import { useActionBuilder } from "../../components/action-builder/use-action-builder";
import { useViz3DContext } from "../Viz3DProvider";
import { SequencePreviewBar } from "./sequence-preview-bar";
import { MeasureToolPanel } from "./MeasureToolPanel";
import { ShapePresetPalette } from "./ShapePresetPalette";
import { ViewMenu } from "./ViewMenu";
import { ViewportCellsOverlay } from "./ViewportCellsOverlay";

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
  const { mode } = useConsoleMode();
  const {
    monitorPanelVisible,
    rightPanelVisible,
    manualPanelVisible,
    programPanelVisible,
    toggleMonitorPanel,
    toggleRightPanel,
    toggleManualPanel,
    toggleProgramPanel,
  } = useControlLayout();
  const manualAvailable = mode !== "show";

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
      pressed: manualAvailable ? manualPanelVisible : rightPanelVisible,
      onToggle: manualAvailable ? toggleManualPanel : toggleRightPanel,
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

/** 动作页：开关显示设备实时位置，与右侧「手动控制」tab 同步 */
const CurrentPoseToggle = () => {
  const { activeRightTab, setActiveRightTab } = useActionBuilder();
  const showing = activeRightTab === "manual";

  return (
    <button
      type="button"
      aria-label="显示当前位置"
      title={showing ? "关闭当前位置" : "显示当前位置"}
      aria-pressed={showing}
      onClick={() => setActiveRightTab(showing ? "selection" : "manual")}
      className={cn(PANEL_TOGGLE_BTN, showing ? "text-primary" : "text-muted-foreground")}
    >
      <Locate aria-hidden />
      当前位置
    </button>
  );
};

/**
 * 预览时 3D 窗口和实时画面要一眼分得开：整圈描边 + 顶部「预览」标签（长按预览没有进度条时也有）。
 * 用 secondary（非实时）色，和实时运行的绿色、选中的青色都区分开。
 */
export const PreviewFrame = ({
  sequenceId,
  belowCellNames = false,
}: {
  sequenceId: number;
  /** 多格时顶行格名在 top-9，标签再往下放，免得盖住右上格的格名 */
  belowCellNames?: boolean;
}) => {
  const { currentProject } = useProject();
  const name = currentProject?.document?.motion.actionSequences.find(
    (sequence) => sequence.id === sequenceId,
  )?.name;
  return (
    <>
      <div
        aria-hidden
        data-testid="preview-frame"
        className="pointer-events-none absolute inset-0 rounded-md border-2 border-secondary"
      />
      <div
        role="status"
        className={cn(
          "pointer-events-none absolute left-1/2 flex max-w-[80%] -translate-x-1/2 items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-body-sm font-semibold text-secondary-foreground",
          belowCellNames ? "top-[4.5rem]" : "top-11",
        )}
      >
        <span className="inline-block size-2 shrink-0 rounded-full bg-secondary-foreground" aria-hidden />
        <span className="truncate">{name ? `预览「${name}」` : "预览"}</span>
        <span className="shrink-0 font-normal">· 设备不动</span>
      </div>
    </>
  );
};

export const ViewportOverlay = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const preview = useSequencePreview();
  // 移动 / 旋转工具要「编辑工程配置」，轴运动中也不给
  const canEdit = !useSetupEditState().readOnly;
  const showToolMode = activeNav === "devices" && canEdit;
  const isControl = activeNav === "control";
  const isSequences = activeNav === "sequences";
  const [mode, setMode] = useState<ToolMode>(() => engine.getMode());
  const [multiCell, setMultiCell] = useState(() => (engine.getViewportState()?.cells.length ?? 1) > 1);

  useEffect(() => {
    const handleMode = (next: ToolMode) => setMode(next);
    const handleViewport = (state: ViewportState) => setMultiCell(state.cells.length > 1);
    engine.events.on("modeChange", handleMode);
    engine.events.on("viewportChange", handleViewport);
    return () => {
      engine.events.off("modeChange", handleMode);
      engine.events.off("viewportChange", handleViewport);
    };
  }, [engine]);

  const stopPointer = (event: { stopPropagation(): void }) => {
    event.stopPropagation();
  };

  const handleMode = (next: ToolMode) => engine.setMode(next);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-md">
      <ViewportCellsOverlay toolPaletteVisible={showToolMode} onPointerGuard={stopPointer} />
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
          {mode === "measure" ? <MeasureToolPanel onPointerGuard={stopPointer} /> : null}
        </>
      )}

      <div
        onPointerDown={stopPointer}
        className="pointer-events-auto relative z-10 flex items-center justify-between px-2 py-1"
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
            <CurrentPoseToggle />
          </div>
        ) : null}
      </div>
      {(isControl || isSequences) && preview.sequenceId !== null ? (
        <PreviewFrame sequenceId={preview.sequenceId} belowCellNames={multiCell} />
      ) : null}
      {(isControl || isSequences) && preview.sequenceId !== null && !preview.holdMode ? (
        <SequencePreviewBar />
      ) : null}
    </div>
  );
};
