import {
  Minus,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/app/components/ics/icon-button";
import { Switch } from "@/app/components/ui/switch";
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
  <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border bg-muted/30 px-2">
    {sequenceName && (
      <>
        <span className="max-w-[180px] truncate px-1 text-body-sm font-medium text-foreground">
          {sequenceName}
        </span>
        <div className="mx-1 h-4 w-px bg-border" aria-hidden />
      </>
    )}
    {trajectoryMode && onTrajectoryModeChange ? (
      <>
        <label className="inline-flex h-7 items-center gap-2 px-1">
          <span className="text-body-sm text-foreground">强制轨迹</span>
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
            className="inline-flex h-7 items-center gap-2 px-1"
            title={!canLoop ? loopDisabledHint : undefined}
          >
            <span className="text-body-sm text-foreground">循环</span>
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
        <div className="mx-1 h-4 w-px bg-border" aria-hidden />
      </>
    ) : null}
    <IconButton icon={Trash2} label="删除" onClick={onDelete} disabled={!canDelete} />
    <div className="mx-1 h-4 w-px bg-border" aria-hidden />
    <button
      type="button"
      onClick={onSave}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-body-sm text-foreground hover:bg-muted"
    >
      <Save className="h-3.5 w-3.5" aria-hidden />
      保存
      <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
    </button>
    <div className="ml-auto flex items-center gap-1">
      <IconButton icon={Minus} label="缩小间隔（块变宽）" onClick={onZoomOut} disabled={!canZoomOut} />
      <span
        className="min-w-[3rem] text-center font-mono text-mono-sm tabular-nums text-muted-foreground"
        title="自适应主刻度（秒）"
      >
        {formatMajorStep(majorStepSec)}
      </span>
      <IconButton icon={Plus} label="放大间隔（块变窄）" onClick={onZoomIn} disabled={!canZoomIn} />
    </div>
  </div>
);
