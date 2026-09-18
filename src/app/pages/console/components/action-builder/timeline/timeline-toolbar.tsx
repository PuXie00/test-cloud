import type { ButtonHTMLAttributes, ElementType } from "react";
import { Minus, Plus, Save, Trash2 } from "lucide-react";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import type { TrajectoryMode } from "@shared/action-sequence";

type TimelineToolbarProps = {
  sequenceName?: string;
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
  onSave?: () => void;
  onDelete?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
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
  sequenceName,
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
  onSave,
  onDelete,
  onZoomIn,
  onZoomOut,
}: TimelineToolbarProps) => (
  <div className="flex h-9 shrink-0 items-center gap-2 bg-muted px-2">
    {sequenceName ? (
      <span className="max-w-45 truncate text-body-sm font-medium text-foreground">
        {sequenceName}
      </span>
    ) : null}

    {trajectoryMode && onTrajectoryModeChange ? (
      <div className="flex items-center gap-3">
        <label className="inline-flex h-7 items-center gap-1.5">
          <span className="text-body-sm text-muted-foreground">强制轨迹</span>
          <Switch
            aria-label="强制轨迹"
            checked={trajectoryMode === "forced"}
            onCheckedChange={(checked) =>
              onTrajectoryModeChange(checked ? "forced" : "non-forced")
            }
          />
        </label>
        {onLoopChange ? (
          <label
            className="inline-flex h-7 items-center gap-1.5"
            title={!canLoop ? loopDisabledHint : undefined}
          >
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
      </div>
    </div>
  </div>
);
