import type { TrajectoryMode } from "@shared/action-sequence";
import { cn } from "@/app/components/ui/utils";

export const FORCED_TRAJECTORY_LABEL = "强制";

export const isForcedTrajectory = (mode: TrajectoryMode | undefined): boolean =>
  mode === true;

export const ForcedTrajectoryBadge = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "shrink-0 rounded-sm bg-muted px-1 py-0.5 text-label-caps text-foreground",
      className,
    )}
  >
    {FORCED_TRAJECTORY_LABEL}
  </span>
);
