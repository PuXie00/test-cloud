import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmergencyStopButton } from "@/app/components/ics/emergency-stop-button";
import { cn } from "@/app/components/ui/utils";
import { useConsoleMode } from "../../hooks/use-console-mode";
import { useExecCards } from "../../hooks/use-exec-cards";
import { usePlcRuntime } from "../../hooks/plc-runtime-provider";
import { useProgram } from "../../hooks/use-program";

const HOLD_MS = 3000;

export const LockScreen = () => {
  const { isLocked, unlock } = useConsoleMode();
  const { emergencyStopAll } = useExecCards();
  const { allStopAll } = usePlcRuntime();
  const { program } = useProgram();
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const [grace, setGrace] = useState(false);

  useEffect(() => {
    if (!isLocked) {
      setHoldProgress(0);
      setGrace(true);
      const id = window.setTimeout(() => setGrace(false), 500);
      return () => window.clearTimeout(id);
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const startHold = () => {
    startRef.current = Date.now();
    const step = () => {
      if (startRef.current === null) return;
      const elapsed = Date.now() - startRef.current;
      const ratio = Math.min(1, elapsed / HOLD_MS);
      setHoldProgress(ratio);
      if (ratio >= 1) {
        unlock();
        cancelHold();
        return;
      }
      holdRef.current = window.requestAnimationFrame(step);
    };
    holdRef.current = window.requestAnimationFrame(step);
  };

  const cancelHold = () => {
    if (holdRef.current !== null) window.cancelAnimationFrame(holdRef.current);
    holdRef.current = null;
    startRef.current = null;
    setHoldProgress(0);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background/95",
        grace && "pointer-events-none"
      )}
      role="dialog"
      aria-label="锁屏"
    >
      <div className="space-y-1 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="text-heading-md text-foreground">已锁定 — 防误触</p>
        <p className="text-body-sm text-muted-foreground">
          项目: <span className="font-mono text-foreground">{program.name}</span>
        </p>
        <p className="text-body-sm text-muted-foreground">已锁屏 · 防误触</p>
      </div>

      <button
        type="button"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        className="relative h-16 w-72 overflow-hidden rounded-sm border-2 border-primary text-primary"
      >
        <span
          className="absolute inset-y-0 left-0 bg-primary/20"
          style={{ width: `${holdProgress * 100}%` }}
        />
        <span className="relative font-semibold">
          长按 3 秒解锁 ({Math.round(holdProgress * 3)} / 3)
        </span>
      </button>

      <p className="text-body-sm text-muted-foreground">急停按钮始终响应 ↓</p>
      <EmergencyStopButton
        onClick={() => {
          emergencyStopAll();
          void allStopAll();
        }}
      />
    </div>
  );
};
