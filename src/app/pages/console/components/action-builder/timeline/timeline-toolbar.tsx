import type { ButtonHTMLAttributes, ElementType } from "react";
import {
  ChevronDown,
  Eye,
  Flag,
  Magnet,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  RotateCcw,
  Route,
  Save,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import type { TimelineMarker } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { TrajectoryMode } from "@shared/action-sequence";
import { CURVE_GRAPHS, type CurveGraph, type TimelineViewMode } from "./curve-data";
import { formatTime } from "./timeline-data";
import { formatProjectHistoryShortcutHint } from "@/app/project/project-history-shortcuts";

type TimelineToolbarProps = {
  trajectoryMode?: TrajectoryMode;
  onTrajectoryModeChange?: (mode: TrajectoryMode) => void;
  loop?: boolean;
  canLoop?: boolean;
  loopDisabledHint?: string;
  onLoopChange?: (loop: boolean) => void;
  /** 当前自适应主刻度间隔（秒），仅展示 */
  majorStepSec: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canDelete: boolean;
  canPlay?: boolean;
  isPlaying?: boolean;
  atEnd?: boolean;
  onPlayToggle?: () => void;
  onSave?: () => void;
  /** 有未保存的草稿才能保存 */
  canSave?: boolean;
  /** 动作编辑页自己的撤销 / 重做 */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onDelete?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  /** 缩放到全部（\） */
  onZoomFit?: () => void;
  /** 上一个 / 下一个关键帧（Alt+← / Alt+→） */
  onPrevKeyframe?: () => void;
  onNextKeyframe?: () => void;
  canPrevKeyframe?: boolean;
  canNextKeyframe?: boolean;
  /** 吸附开关（S） */
  snapEnabled?: boolean;
  onSnapToggle?: () => void;
  /** 「标记」菜单：添加标记（M），点列表里的标记跳过去 */
  markers?: readonly TimelineMarker[];
  onAddMarker?: () => void;
  onJumpToMarker?: (marker: TimelineMarker) => void;
  /** 「视图」菜单：显示曲线（轨道 / 曲线视图）、曲线看位置还是速度、看哪根虚轴 */
  viewMode?: TimelineViewMode;
  onViewModeChange?: (mode: TimelineViewMode) => void;
  curveGraph?: CurveGraph;
  onCurveGraphChange?: (graph: CurveGraph) => void;
  /** available 为 false：显示的物体都没有这根轴，或序列不控制它 */
  curveAxis?: VirtualAxisId;
  curveAxes?: readonly { axis: VirtualAxisId; available: boolean }[];
  onCurveAxisChange?: (axis: VirtualAxisId) => void;
};

const formatMajorStep = (sec: number): string => {
  if (sec < 1) return `${sec}s`;
  if (Number.isInteger(sec)) return `${sec}s`;
  return `${sec}s`;
};

const toolIconClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const ToolbarIcon = ({
  icon: Icon,
  label,
  className,
  ...props
}: {
  icon: ElementType;
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" aria-label={label} className={cn(toolIconClass, className)} {...props}>
    <Icon className="h-3.5 w-3.5" aria-hidden />
  </button>
);

const menuButtonClass =
  "inline-flex h-7 items-center gap-1 rounded-sm px-2 text-body-sm  transition-colors hover:bg-accent hover:text-foreground";

/** 视图菜单里的选项触屏时加高 */
const viewMenuItemClass = "[@media(pointer:coarse)]:py-2.5";

/** 勾选、切换后菜单不关，可以连着设几项 */
const keepMenuOpen = (event: Event) => event.preventDefault();

export const TimelineToolbar = ({
  trajectoryMode,
  onTrajectoryModeChange,
  loop = false,
  canLoop = false,
  loopDisabledHint,
  onLoopChange,
  majorStepSec,
  canZoomIn,
  canZoomOut,
  canDelete,
  canPlay = false,
  isPlaying = false,
  atEnd = false,
  onPlayToggle,
  onSave,
  canSave = true,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onDelete,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onPrevKeyframe,
  onNextKeyframe,
  canPrevKeyframe = false,
  canNextKeyframe = false,
  snapEnabled = false,
  onSnapToggle,
  markers = [],
  onAddMarker,
  onJumpToMarker,
  viewMode,
  onViewModeChange,
  curveGraph,
  onCurveGraphChange,
  curveAxis,
  curveAxes,
  onCurveAxisChange,
}: TimelineToolbarProps) => {
  const playLabel = isPlaying ? "暂停" : atEnd ? "重新播放" : "播放";
  const PlayIcon = isPlaying ? Pause : atEnd ? RotateCcw : Play;

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 bg-muted px-2">

    {onUndo || onRedo ? (
      <div className="flex items-center">
        {onUndo ? (
          <ToolbarIcon
            icon={Undo2}
            label="撤销"
            title={`撤销（${formatProjectHistoryShortcutHint("undo")}）`}
            onClick={onUndo}
            disabled={!canUndo}
          />
        ) : null}
        {onRedo ? (
          <ToolbarIcon
            icon={Redo2}
            label="重做"
            title={`重做（${formatProjectHistoryShortcutHint("redo")}）`}
            onClick={onRedo}
            disabled={!canRedo}
          />
        ) : null}
      </div>
    ) : null}

    {viewMode !== undefined && onViewModeChange ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="视图" className={menuButtonClass}>
            {/* <Eye className="h-3.5 w-3.5" aria-hidden /> */}
            视图
            {/* <ChevronDown className="h-3 w-3" aria-hidden /> */}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem] border-border bg-card text-foreground">
          <DropdownMenuCheckboxItem
            checked={viewMode === "curves"}
            onCheckedChange={(checked) => onViewModeChange(checked ? "curves" : "tracks")}
            onSelect={keepMenuOpen}
            className={viewMenuItemClass}
          >
            显示曲线
          </DropdownMenuCheckboxItem>
          {curveGraph !== undefined && onCurveGraphChange ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">曲线</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={curveGraph}
                onValueChange={(value) => onCurveGraphChange(value as CurveGraph)}
              >
                {CURVE_GRAPHS.map((graph) => (
                  <DropdownMenuRadioItem
                    key={graph.id}
                    value={graph.id}
                    disabled={viewMode !== "curves"}
                    onSelect={keepMenuOpen}
                    className={viewMenuItemClass}
                  >
                    {graph.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}
          {curveAxis !== undefined && curveAxes && onCurveAxisChange ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">虚轴</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={curveAxis}
                onValueChange={(value) => onCurveAxisChange(value as VirtualAxisId)}
              >
                {curveAxes.map(({ axis, available }) => (
                  <DropdownMenuRadioItem
                    key={axis}
                    value={axis}
                    disabled={viewMode !== "curves" || !available}
                    onSelect={keepMenuOpen}
                    className={viewMenuItemClass}
                  >
                    {axis.toUpperCase()}
                    {available ? null : <DropdownMenuShortcut>没有曲线</DropdownMenuShortcut>}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null}
    
    {onAddMarker ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="标记" className={menuButtonClass}>
            {/* <Flag className="h-3.5 w-3.5" aria-hidden /> */}
            标记
          {/*  <ChevronDown className="h-3 w-3" aria-hidden /> */}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 min-w-[14rem] overflow-y-auto border-border bg-card text-foreground"
        >
          <DropdownMenuItem onSelect={onAddMarker}>
            添加标记
            <DropdownMenuShortcut>M</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {markers.length === 0 ? (
            <DropdownMenuItem disabled>还没有标记</DropdownMenuItem>
          ) : (
            markers.map((marker) => (
              <DropdownMenuItem key={marker.id} onSelect={() => onJumpToMarker?.(marker)}>
                <span className="min-w-0 truncate">{marker.name}</span>
                <DropdownMenuShortcut className="font-mono tabular-nums">
                  {formatTime(marker.atMs)} s
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null}

    {onPlayToggle ? (
      <div className="flex items-center">
        {onPrevKeyframe ? (
          <ToolbarIcon
            icon={SkipBack}
            label="上一个关键帧"
            title="上一个关键帧（Alt+←）"
            onClick={onPrevKeyframe}
            disabled={!canPrevKeyframe}
          />
        ) : null}
        <ToolbarIcon
          icon={PlayIcon}
          label={playLabel}
          onClick={onPlayToggle}
          disabled={!canPlay && !isPlaying}
          className="text-primary hover:text-primary"
        />
        {onNextKeyframe ? (
          <ToolbarIcon
            icon={SkipForward}
            label="下一个关键帧"
            title="下一个关键帧（Alt+→）"
            onClick={onNextKeyframe}
            disabled={!canNextKeyframe}
          />
        ) : null}
      </div>
    ) : null}

    {trajectoryMode !== undefined && onTrajectoryModeChange ? (
      <div className="flex items-center gap-3">
        <label className="inline-flex h-7 items-center gap-0.5">
          <Route className="h-3.5 w-3.5 text-foreground" aria-hidden />
          <span className="text-body-sm text-muted-foreground">强制轨迹</span>
          <Switch
            aria-label="强制轨迹"
            checked={trajectoryMode}
            onCheckedChange={onTrajectoryModeChange}
          />
        </label>
        {onLoopChange ? (
          <label
            className="inline-flex h-7 items-center gap-0.5"
            title={!canLoop ? loopDisabledHint : undefined}
          >
            <Repeat
              className={cn(
                "h-3.5 w-3.5",
                canLoop ? "text-secondary" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span className="text-body-sm text-muted-foreground">循环</span>
            <Switch
              aria-label="循环"
              checked={loop && canLoop}
              disabled={!canLoop}
              onCheckedChange={(checked) => {
                if (!canLoop) return;
                onLoopChange(checked);
              }}
            />
          </label>
        ) : null}
      </div>
    ) : null}

    <div className="ml-auto flex items-center gap-1">
      <ToolbarIcon icon={Trash2} label="删除序列" onClick={onDelete} disabled={!canDelete} />
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        title={canSave ? "保存到节目列表（不是保存工程）" : "没有未保存的修改"}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-body-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
      >
        <Save className="h-3.5 w-3.5" aria-hidden />
        保存
      </button>
      {onSnapToggle ? (
        <ToolbarIcon
          icon={Magnet}
          label="吸附"
          title={snapEnabled ? "吸附已开（S）；拖动时按住 Alt 临时不吸" : "吸附已关（S）"}
          aria-pressed={snapEnabled}
          onClick={onSnapToggle}
          className={cn(snapEnabled && "bg-accent text-primary hover:text-primary")}
        />
      ) : null}
      <div className="ml-1 flex h-7 items-center rounded-sm bg-input-background">
        <ToolbarIcon
          icon={Minus}
          label="缩小间隔（块变宽）"
          onClick={onZoomOut}
          disabled={!canZoomOut}
        />
        <span
          className="min-w-12 px-1 text-center font-mono text-mono-sm tabular-nums text-muted-foreground"
          title="自适应主刻度（秒）"
        >
          {formatMajorStep(majorStepSec)}
        </span>
        <ToolbarIcon
          icon={Plus}
          label="放大间隔（块变窄）"
          onClick={onZoomIn}
          disabled={!canZoomIn}
        />
        {onZoomFit ? (
          <ToolbarIcon icon={Maximize2} label="适合窗口" title="适合窗口（\）" onClick={onZoomFit} />
        ) : null}
      </div>
    </div>
  </div>
  );
};
