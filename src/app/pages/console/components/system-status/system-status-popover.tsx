import { Activity, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { resolveSimulationSwitchState } from "@/app/pages/console/hooks/plc-master-runtime";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import {
  LIFECYCLE_LABELS,
  isLifecycleBusy,
  type SystemStatusKind,
} from "@/app/pages/console/hooks/system-status-aggregate";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { plcVerifyStatusLabel } from "@/app/pages/console/hooks/project-verify";

const PILL_STYLES: Record<SystemStatusKind, string> = {
  unconfigured: "bg-muted text-muted-foreground hover:bg-muted/80",
  configuring: "bg-primary/10 text-primary hover:bg-primary/20",
  initializing: "bg-primary/10 text-primary hover:bg-primary/20",
  configFailed: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  suspended: "bg-warning/10 text-warning hover:bg-warning/20",
  versionMismatch: "bg-warning/10 text-warning hover:bg-warning/20",
  projectMismatch: "bg-warning/10 text-warning hover:bg-warning/20",
  normal: "bg-show/10 text-show hover:bg-show/20",
};

const DOT_STYLES: Record<SystemStatusKind, string> = {
  unconfigured: "bg-muted-foreground",
  configuring: "bg-primary animate-pulse",
  initializing: "bg-primary animate-pulse",
  configFailed: "bg-destructive",
  suspended: "bg-warning",
  versionMismatch: "bg-warning",
  projectMismatch: "bg-warning",
  normal: "bg-show",
};

const formatSimulationSummary = (simulatingCount: number, totalCount: number): string => {
  if (simulatingCount === totalCount && totalCount > 0) {
    return `仿真中 · ${totalCount} 台主控`;
  }
  return `未仿真 · 共 ${totalCount} 台主控`;
};

export const SystemStatusPopover = () => {
  const [open, setOpen] = useState(false);
  const { plcs } = useProjectStore();
  const { runtimes, systemStatus, setSimulationAll, simulationSwitchPending } = usePlcRuntime();
  const switchState = resolveSimulationSwitchState(runtimes, simulationSwitchPending);

  const runtimeById = new Map(runtimes.map((item) => [item.plcId, item]));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            systemStatus.detail
              ? `系统状态：${systemStatus.label} · ${systemStatus.detail}`
              : `系统状态：${systemStatus.label}`
          }
          aria-expanded={open}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-body-sm transition-colors",
            PILL_STYLES[systemStatus.kind],
          )}
        >
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", DOT_STYLES[systemStatus.kind])}
            aria-hidden
          />
          <span>{systemStatus.label}</span>
          {systemStatus.detail ? (
            <span className="max-w-28 truncate text-body-sm opacity-80">
              · {systemStatus.detail}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-90 overflow-hidden rounded-lg border-0 bg-card p-0 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
      >
        <div className="flex items-center justify-between bg-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden />
            <span className="text-body-md font-semibold text-foreground">系统状态</span>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setOpen(false)}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 bg-background p-3">
          <div className="rounded-md bg-muted p-3">
            <p className="text-label-caps text-muted-foreground">聚合状态</p>
            <p className="mt-1 text-body-md font-medium text-foreground">
              {systemStatus.detail
                ? `${systemStatus.label} · ${systemStatus.detail}`
                : systemStatus.label}
            </p>
            {systemStatus.totalCount > 0 ? (
              <p className="mt-1 font-mono text-mono-sm tabular-nums text-muted-foreground">
                {formatSimulationSummary(
                  systemStatus.simulatingCount,
                  systemStatus.totalCount,
                )}
              </p>
            ) : null}
          </div>

          {plcs.length === 0 ? (
            <p className="rounded-md bg-input-background px-3 py-2 text-body-sm text-muted-foreground">
              暂无主控，请先完成工程配置
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {plcs.map((plc) => {
                const runtime = runtimeById.get(plc.id);
                const lifecycle = runtime?.lifecycle ?? "suspended";
                const busy = isLifecycleBusy(lifecycle);
                const simulation = runtime?.simulation ?? false;
                const verifyLabel = runtime ? plcVerifyStatusLabel(runtime) : undefined;
                return (
                  <li
                    key={plc.id}
                    className="rounded-md border border-border/60 bg-input-background px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-body-sm font-medium text-foreground">
                        {formatPlcDisplayName(plcs, plc)}
                      </p>
                      {simulation ? (
                        <span className="shrink-0 text-label-caps text-secondary">仿真</span>
                      ) : null}
                    </div>
                    <p className="text-body-sm text-muted-foreground">
                      {LIFECYCLE_LABELS[lifecycle]}
                      {runtime?.lifecycleReason ? ` · ${runtime.lifecycleReason}` : ""}
                      {verifyLabel ? ` · ${verifyLabel}` : ""}
                      {busy ? (
                        <Loader2
                          className="ml-1 inline h-3 w-3 animate-spin text-primary"
                          aria-hidden
                        />
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {plcs.length > 0 ? (
            <div
              className="flex items-center justify-between gap-2 border-t border-border/40 pt-3"
              title={switchState.title}
            >
              <span className="text-body-sm text-foreground">仿真</span>
              <Switch
                checked={switchState.checked}
                disabled={switchState.disabled}
                onCheckedChange={(checked) => {
                  void setSimulationAll(checked);
                }}
                aria-label="全部仿真"
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
