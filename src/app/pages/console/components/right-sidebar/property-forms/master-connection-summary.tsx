import { useHaWholePlcBlock } from "@/app/hot-standby/use-ha-whole-plc-block";
import { usePermissions } from "@/app/auth/permissions";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isCppAckFailed } from "@shared/csocket/ack";
import { cn } from "@/app/components/ui/utils";
import type { PlcOnline } from "@/app/pages/console/hooks/plc-online";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";

type OnlineMeta = { label: string; dotClass: string; textClass: string };

/** 在线只看扫描结果：扫到 IP 即在线，型号不对应标黄 */
const onlineMeta = (online: PlcOnline): OnlineMeta => {
  switch (online.kind) {
    case "unscanned":
      return { label: "未扫描", dotClass: "bg-muted-foreground", textClass: "text-muted-foreground" };
    case "offline":
      return { label: "离线", dotClass: "bg-muted-foreground", textClass: "text-muted-foreground" };
    case "online":
      return online.modelMatch
        ? { label: "在线", dotClass: "bg-show", textClass: "text-show" }
        : { label: "型号不匹配", dotClass: "bg-warning", textClass: "text-warning" };
  }
};

type MasterConnectionSummaryProps = {
  plcId: number;
  onOpenReconciliation?: () => void;
};

export const MasterConnectionSummary = ({
  plcId,
  onOpenReconciliation,
}: MasterConnectionSummaryProps) => {
  const { findPlc } = useProjectStore();
  const { getPlcRuntime, getPlcOnline, scan, scanAll } = usePlcRuntime();
  const canResetPlc = usePermissions().can("build.plc");
  // 主备热备：PLC 复位是整台 PLC 的操作，备机上不能做
  const haBlock = useHaWholePlcBlock();
  const plc = findPlc(plcId);
  const runtime = getPlcRuntime(plcId);
  const online = getPlcOnline(plcId);

  if (!plc) return null;

  const meta = onlineMeta(online);
  const hasDiff = online.kind === "online" && online.hasDiff;

  const handleScan = () => {
    void scanAll().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "扫描失败");
    });
  };

  const handlePlcReset = () => {
    if (!canResetPlc || haBlock) return;
    // 后续接入 C++
    const send = window.csocketApi?.resetPlc;
    if (!send) return;
    void send([{ deviceId: plcId }])
      .then((result) => {
        if (isCppAckFailed(result)) toast.error("PLC复位失败");
      })
      .catch(() => {
        toast.error("PLC复位失败");
      });
  };

  return (
    <div className="space-y-3 rounded-md bg-muted p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-label-caps text-muted-foreground">在线状态</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
            <span className={`text-body-sm font-medium ${meta.textClass}`}>{meta.label}</span>
            {runtime.simulation ? (
              <span className="text-label-caps text-secondary">仿真</span>
            ) : null}
          </div>
          {online.kind === "online" ? (
            <p className="font-mono text-mono-sm tabular-nums text-muted-foreground">
              实轴 {online.realAxisCount} / 配置 {online.configuredCount}
            </p>
          ) : null}
        </div>
        {hasDiff && onOpenReconciliation ? (
          <button
            type="button"
            onClick={onOpenReconciliation}
            aria-label="打开连接对账"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-warning hover:bg-accent pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleScan}
          aria-busy={scan.scanning}
          disabled={scan.scanning}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-body-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11"
        >
          {scan.scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          重新扫描
        </button>
        {runtime.connection === "connected" && canResetPlc ? (
          <button
            data-guide="console-master-reset"
            type="button"
            onClick={handlePlcReset}
            aria-label="PLC复位"
            disabled={haBlock !== null}
            title={haBlock ?? undefined}
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-body-sm hover:bg-accent pointer-coarse:h-11 disabled:pointer-events-none disabled:opacity-50"
          >
            PLC复位
          </button>
        ) : null}
      </div>
    </div>
  );
};
