import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "./collab-surfaces";
import type { HostRecord } from "./collab-types";

type TopologyDiagramProps = {
  primaryHost: HostRecord | undefined;
  standbyHost: HostRecord | undefined;
};

const HostNode = ({
  host,
  label,
  statusLabel,
  variant,
}: {
  host: HostRecord | undefined;
  label: string;
  statusLabel: string;
  variant: "primary" | "standby";
}) => {
  const isPrimary = variant === "primary";

  return (
    <div
      className={cn(
        "flex w-[168px] flex-col gap-1.5 rounded-md p-3",
        isPrimary ? cn(COLLAB_SURFACES.recessed, "ring-2 ring-show") : COLLAB_SURFACES.elevated,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-label-caps", isPrimary ? "text-show" : "text-muted-foreground")}>
          {label}
        </span>
        <span className="inline-flex items-center gap-1 text-body-sm text-show">
          <span className="h-1.5 w-1.5 rounded-full bg-show" aria-hidden />
          {statusLabel}
        </span>
      </div>
      <span className="font-mono text-mono-sm tabular-nums text-foreground">
        {host?.hostname ?? "—"}
      </span>
      <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
        {host?.ip ?? "—"}
      </span>
    </div>
  );
};

export const TopologyDiagram = ({ primaryHost, standbyHost }: TopologyDiagramProps) => (
  <div
    className={cn(
      "flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-md p-5",
      COLLAB_SURFACES.section,
    )}
  >
    <div className="flex w-full max-w-xl items-center justify-center gap-3">
      <HostNode host={primaryHost} label="主控机" statusLabel="运行中" variant="primary" />
      <div className="flex flex-col items-center px-1 text-primary">
        <div className="flex items-center gap-1 border-b border-dashed border-primary pb-1">
          <ArrowLeftRight className="h-4 w-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap text-body-sm">数据同步</span>
        </div>
      </div>
      <HostNode host={standbyHost} label="备控机" statusLabel="就绪" variant="standby" />
    </div>
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-body-sm">
      <span className="text-show">
        同步延迟: <span className="font-mono tabular-nums">12ms</span>
      </span>
      <span className="text-border">|</span>
      <span className="text-muted-foreground">
        上次同步: <span className="font-mono tabular-nums text-foreground">0.5s</span> 前
      </span>
    </div>
  </div>
);
