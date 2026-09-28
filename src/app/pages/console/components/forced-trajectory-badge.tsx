import type { TrajectoryMode } from "@shared/action-sequence";
import { Route } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

export const FORCED_TRAJECTORY_LABEL = "强制";

export const isForcedTrajectory = (mode: TrajectoryMode | undefined): boolean =>
  mode === true;

export const ForcedTrajectoryBadge = ({ className }: { className?: string }) => (
  <span
    className={cn("inline-flex shrink-0 text-warning", className)}
    title="强制轨迹"
  >
    <Route className="h-3.5 w-3.5" aria-hidden />
    <span className="sr-only">{FORCED_TRAJECTORY_LABEL}</span>
  </span>
);
