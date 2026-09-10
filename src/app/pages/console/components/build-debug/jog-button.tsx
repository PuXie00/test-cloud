import { useRef, type ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";

type JogButtonProps = {
  onHoldStart: () => void;
  onHoldEnd: () => void;
  disabled?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
};

/** 按下点动，抬起停止 */
export const JogButton = ({
  onHoldStart,
  onHoldEnd,
  disabled,
  ariaLabel,
  children,
  className,
}: JogButtonProps) => {
  const holding = useRef(false);

  const handlePointerDown = () => {
    if (disabled) return;
    holding.current = true;
    onHoldStart();
  };

  const handlePointerEnd = () => {
    if (!holding.current) return;
    holding.current = false;
    onHoldEnd();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      className={cn(
        "inline-flex h-10 min-w-[44px] items-center justify-center rounded-md border border-border bg-input-background text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
        "[@media(pointer:coarse)]:h-11",
        className,
      )}
    >
      {children}
    </button>
  );
};
