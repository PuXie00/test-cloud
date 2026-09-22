import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { cn } from "@/app/components/ui/utils";
import type { PoseSpeedMode } from "@/app/project/action-sequence/initial-pose-gate";

type InitialPoseDialogProps = {
  open: boolean;
  speedMode: PoseSpeedMode;
  extraSeconds: number | null;
  totalSeconds: number | null;
  errorMessage: string | null;
  onSpeedModeChange: (mode: PoseSpeedMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const formatPoseSeconds = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  return `${Math.round(seconds * 10) / 10} 秒`;
};

const speedButtonClass = (selected: boolean): string =>
  cn(
    "h-10 rounded-md px-3 text-body-sm font-semibold",
    selected
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-transparent text-foreground",
  );

export const InitialPoseDialog = ({
  open,
  speedMode,
  extraSeconds,
  totalSeconds,
  errorMessage,
  onSpeedModeChange,
  onCancel,
  onConfirm,
}: InitialPoseDialogProps) => {
  const confirmDisabled = errorMessage !== null || extraSeconds === null || totalSeconds === null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent
        role="dialog"
        className="border-0 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-semibold leading-5 text-foreground">未在起始位姿</AlertDialogTitle>
          <AlertDialogDescription className="text-body-sm text-muted-foreground">
            选择过渡速度后确认，槽位才会进入准备。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md bg-background p-4">
          <div className="flex gap-2" role="group" aria-label="过渡速度">
            <button
              type="button"
              className={speedButtonClass(speedMode === "default")}
              aria-pressed={speedMode === "default"}
              onClick={() => onSpeedModeChange("default")}
            >
              默认速度
            </button>
            <button
              type="button"
              className={speedButtonClass(speedMode === "fastest")}
              aria-pressed={speedMode === "fastest"}
              onClick={() => onSpeedModeChange("fastest")}
            >
              最快速度
            </button>
          </div>
          <p data-testid="pose-extra-time" className="mt-4 font-mono text-mono-md tabular-nums text-foreground">
            多出时间 {formatPoseSeconds(extraSeconds)}
          </p>
          <p data-testid="pose-total-time" className="mt-1 font-mono text-mono-md tabular-nums text-foreground">
            总用时 {formatPoseSeconds(totalSeconds)}
          </p>
          {errorMessage ? <p className="mt-3 text-body-sm text-destructive">{errorMessage}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">取消</AlertDialogCancel>
          <button
            type="button"
            className="h-10 rounded-md border border-border bg-transparent px-3 text-foreground"
            onClick={() => undefined}
          >
            立即到起点
          </button>
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            确认
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
