import type { ButtonHTMLAttributes, ElementType } from "react";
import {
  Magnet,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Route,
  Save,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import type { TrajectoryMode } from "@shared/action-sequence";

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
}: TimelineToolbarProps) => {
  const playLabel = isPlaying ? "暂停" : atEnd ? "重新播放" : "播放";
  const PlayIcon = isPlaying ? Pause : atEnd ? RotateCcw : Play;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 bg-muted px-2">

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
        <label className="inline-flex h-7 items-center gap-1.5">
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
            className="inline-flex h-7 items-center gap-1.5"
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
        className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-body-sm text-foreground transition-colors hover:bg-accent"
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
