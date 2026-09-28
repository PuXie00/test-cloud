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

export type StartTransitionSummary = {
  forced: boolean;
  nearest: boolean;
  reverse: boolean;
  targetFrameMs: number;
  transitionSeconds: number;
  programSeconds: number;
  totalSeconds: number;
};

type InitialPoseDialogProps = {
  open: boolean;
  summary: StartTransitionSummary | null;
  blockedMessage: string | null;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const formatSeconds = (seconds: number): string => `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒`;

const formatDelta = (seconds: number): string => {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded === 0) return "不变";
  return `${rounded > 0 ? "多" : "少"} ${Math.abs(rounded).toFixed(1)} 秒`;
};

const SummaryRow = ({
  label,
  value,
  testId,
  mono = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  testId?: string;
  mono?: boolean;
  emphasis?: boolean;
}) => (
  <div className="flex h-8 items-center justify-between gap-3 rounded-sm bg-input-background px-3">
    <dt className="text-body-sm text-muted-foreground">{label}</dt>
    <dd
      data-testid={testId}
      className={cn(
        "text-body-sm",
        mono && "font-mono text-mono-md tabular-nums",
        emphasis ? "text-primary" : "text-foreground",
      )}
    >
      {value}
    </dd>
  </div>
);

export const InitialPoseDialog = ({
  open,
  summary,
  blockedMessage,
  errorMessage,
  onCancel,
  onConfirm,
}: InitialPoseDialogProps) => {
  const confirmDisabled = errorMessage !== null || blockedMessage !== null || summary === null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent className="border-0 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm font-semibold leading-5 text-foreground">未在起始位姿</AlertDialogTitle>
          <AlertDialogDescription className="text-body-sm text-muted-foreground">
            {summary?.forced
              ? "强制轨迹：各成员按默认速度到位，先到的等待，全部到位后从目标帧一起开始。"
              : "非强制轨迹：按最大速度调整各成员，同时到达目标帧，再按编程继续。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md bg-background p-3">
          {summary ? (
            <dl className="flex flex-col gap-1">
              <SummaryRow
                label="接入方式"
                value={`${summary.nearest ? "就近接入" : "回到起点"} · ${summary.reverse ? "反向" : "正向"}`}
              />
              <SummaryRow label="轨迹" value={summary.forced ? "强制" : "非强制"} />
              <SummaryRow
                label="目标帧"
                testId="pose-target-frame"
                mono
                value={`编程 ${formatSeconds(summary.targetFrameMs / 1000)}`}
              />
              <SummaryRow
                label="过渡用时"
                testId="pose-transition-time"
                mono
                value={formatSeconds(summary.transitionSeconds)}
              />
              <SummaryRow
                label="总用时"
                testId="pose-total-time"
                mono
                emphasis
                value={formatSeconds(summary.totalSeconds)}
              />
              <SummaryRow
                label="比编程时长"
                testId="pose-delta-time"
                mono
                value={`${formatDelta(summary.totalSeconds - summary.programSeconds)}（编程 ${formatSeconds(summary.programSeconds)}）`}
              />
            </dl>
          ) : null}
          {blockedMessage ? (
            <p role="alert" className="mt-3 text-body-sm text-destructive">
              {blockedMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="mt-3 text-body-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">取消</AlertDialogCancel>
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
