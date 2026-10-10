import { ArrowLeftRight, Locate, Shield } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

export const SAFE_GROUP_LABEL = "安全组";
export const NEAREST_LABEL = "就近";
export const REVERSE_LABEL = "反向";

export const SafeGroupBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex shrink-0 text-show", className)} title={SAFE_GROUP_LABEL}>
    <Shield className="h-3.5 w-3.5" aria-hidden />
    <span className="sr-only">{SAFE_GROUP_LABEL}</span>
  </span>
);

export const NearestBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex shrink-0 text-foreground", className)} title={NEAREST_LABEL}>
    <Locate className="h-3.5 w-3.5" aria-hidden />
    <span className="sr-only">{NEAREST_LABEL}</span>
  </span>
);

export const ReverseBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex shrink-0 text-foreground", className)} title={REVERSE_LABEL}>
    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
    <span className="sr-only">{REVERSE_LABEL}</span>
  </span>
);
