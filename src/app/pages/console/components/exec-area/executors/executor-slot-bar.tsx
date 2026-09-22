import { cn } from "@/app/components/ui/utils";
import type { FaderSlotState } from "../../../hooks/use-executor-slots";

type ExecutorSlotBarProps = {
  slot: FaderSlotState | undefined;
  repairMessage?: string | null;
  onSafetyGroupChange: (enabled: boolean) => void;
  onNearestStartChange: (enabled: boolean) => void;
  onCancelReady: () => void;
};

export const ExecutorSlotBar = ({
  slot,
  repairMessage,
  onSafetyGroupChange,
  onNearestStartChange,
  onCancelReady,
}: ExecutorSlotBarProps) => {
  if (!slot) return null;

  const hasSequence = Boolean(slot.sequence);
  const isRunning = slot.phase === "running";
  const isReady = slot.phase === "ready";
  const switchesLocked = !hasSequence || Boolean(repairMessage) || slot.isBusy;
  const nearestLocked = switchesLocked || isReady || isRunning;
  const speedUnlocked = isReady || isRunning;

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
      <span className="font-mono text-label-caps text-primary">{slot.label}</span>
      <span className="min-w-0 max-w-48 truncate text-body-sm text-foreground">
        {slot.sequence?.name ?? "空槽"}
      </span>
      {repairMessage ? (
        <span className="min-w-0 truncate text-body-sm text-warning">{repairMessage}</span>
      ) : null}
      {hasSequence ? (
        <>
          <OptionToggle
            label="安全组"
            accessibleName={`${slot.label} 安全组`}
            pressed={slot.safetyGroup}
            disabled={switchesLocked}
            pressedClassName="bg-show/15 text-show"
            onPressedChange={onSafetyGroupChange}
          />
          <OptionToggle
            label="就近启动"
            accessibleName={`${slot.label} 就近启动`}
            pressed={slot.nearestStart}
            disabled={nearestLocked}
            pressedClassName="bg-secondary/20 text-secondary"
            onPressedChange={onNearestStartChange}
          />
          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                "font-mono text-mono-sm tabular-nums",
                speedUnlocked ? "text-primary" : "text-muted-foreground",
              )}
            >
              {speedUnlocked ? `${slot.faderValue}%` : "准备后可调"}
            </span>
            {isReady ? (
              <button
                type="button"
                disabled={slot.isBusy}
                aria-label={`${slot.label} 取消准备`}
                onClick={onCancelReady}
                className="inline-flex h-8 items-center justify-center rounded-sm border border-border px-3 text-body-sm text-foreground hover:bg-accent disabled:opacity-30"
              >
                取消准备
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <span className="ml-auto text-body-sm text-muted-foreground">选择序列后设置</span>
      )}
    </div>
  );
};

const OptionToggle = ({
  label,
  accessibleName,
  pressed,
  disabled,
  pressedClassName,
  onPressedChange,
}: {
  label: string;
  accessibleName: string;
  pressed: boolean;
  disabled: boolean;
  pressedClassName: string;
  onPressedChange: (enabled: boolean) => void;
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    aria-label={accessibleName}
    disabled={disabled}
    onClick={() => onPressedChange(!pressed)}
    className={cn(
      "inline-flex h-8 items-center justify-center rounded-sm px-3 text-body-sm whitespace-nowrap transition-colors disabled:opacity-30",
      pressed ? pressedClassName : "bg-input-background text-muted-foreground hover:bg-accent",
    )}
  >
    {label}
  </button>
);
