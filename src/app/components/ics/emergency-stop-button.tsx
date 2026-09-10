import type { ButtonHTMLAttributes } from "react";
import { cn } from "../ui/utils";

type EmergencyStopButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const EmergencyStopButton = ({ className, ...props }: EmergencyStopButtonProps) => (
  <button
    type="button"
    className={cn(
      "group flex h-9 items-center gap-2 rounded-sm border border-destructive/20 bg-destructive px-4 text-xs font-black text-destructive-foreground shadow-[0_0_20px_rgba(255,180,171,0.2)] transition-all hover:bg-destructive/90 active:scale-95",
      className
    )}
    {...props}
  >
    <span className="uppercase tracking-[0.2em]">急停</span>
  </button>
);
