import { Repeat } from "lucide-react";
import { cn } from "@/app/components/ui/utils";

export const LOOP_LABEL = "循环";

export const LoopBadge = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex shrink-0 text-secondary", className)} title={LOOP_LABEL}>
    <Repeat className="h-3.5 w-3.5" aria-hidden />
    <span className="sr-only">{LOOP_LABEL}</span>
  </span>
);
