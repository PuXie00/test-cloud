import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { reconcileMotorsByOrder } from "@/app/pages/console/hooks/plc-reconciliation";
import type {
  PlcAbnormalReason,
  PlcConnectionState,
} from "@/app/pages/console/hooks/plc-runtime-types";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

const CONNECTION_META: Record<
  PlcConnectionState,
  { label: string; dotClass: string; textClass: string }
> = {
  disconnected: {
    label: "未连接",
    dotClass: "bg-muted-foreground",
    textClass: "text-muted-foreground",
  },
  connecting: {
    label: "连接中",
    dotClass: "bg-primary animate-pulse",
    textClass: "text-primary",
  },
  connected: {
    label: "已连接",
    dotClass: "bg-show",
    textClass: "text-show",
  },
  abnormal: {
    label: "异常",
    dotClass: "bg-warning",
    textClass: "text-warning",
  },
};

const REASON_LABELS: Record<PlcAbnormalReason, string> = {
  countMismatch: "数量不一致",
  scanFailed: "扫描失败",
  timeout: "连接超时",
  authentication: "认证失败",
};

type MasterConnectionSummaryProps = {
  plcId: number;
  onOpenReconciliation?: () => void;
};

export const MasterConnectionSummary = ({
  plcId,
  onOpenReconciliation,
}: MasterConnectionSummaryProps) => {
  const { findPlc, getPlcMotors, plcs } = useProjectStore();
  const { getPlcRuntime, scanAll } = usePlcRuntime();
  const plc = findPlc(plcId);
  const runtime = getPlcRuntime(plcId);

  if (!plc) return null;

  const configuredMotors = getPlcMotors(plcId);
  const configuredCount = configuredMotors.length;
  const reconciliation = reconcileMotorsByOrder(
    configuredMotors,
    runtime.scannedAxes ?? [],
  );
  const actualCount =
    runtime.connection === "disconnected" || runtime.connection === "connecting"
      ? 0
      : reconciliation.online.length +
        reconciliation.modelMismatch.length +
        reconciliation.portMismatch.length;
  const meta = CONNECTION_META[runtime.connection];
  const hasDiff =
    runtime.connection === "abnormal" ||
    reconciliation.modelMismatch.length > 0 ||
    reconciliation.portMismatch.length > 0 ||
    reconciliation.offline.length > 0 ||
    reconciliation.discoveredOnly.length > 0;

  const handleScan = () => {
    void scanAll();
  };

  const handlePlcReset = () => {
    // 后续接入 C++
  };

  return (
    <div className="space-y-3 rounded-md bg-muted p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-label-caps text-muted-foreground">连接状态</p>
          <div className="flex items-center gap-2">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", meta.dotClass)}
              aria-hidden
            />
            <span className={cn("text-body-sm font-medium", meta.textClass)}>{meta.label}</span>
            {runtime.modelMismatch ? (
              <span className="text-body-sm text-warning">型号不匹配</span>
            ) : null}
            {runtime.reason ? (
              <span className="text-body-sm text-warning">· {REASON_LABELS[runtime.reason]}</span>
            ) : null}
            {runtime.simulation ? (
              <span className="text-label-caps text-secondary">仿真</span>
            ) : null}
          </div>
          <p className="font-mono text-mono-sm tabular-nums text-muted-foreground">
            实际 {actualCount} / 配置 {configuredCount}
          </p>
        </div>
        {hasDiff && onOpenReconciliation ? (
          <button
            type="button"
            onClick={onOpenReconciliation}
            aria-label="打开连接对账"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-warning hover:bg-accent"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {runtime.connection === "connected" || runtime.connection === "abnormal" ? (
          <button
            type="button"
            onClick={handleScan}
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-body-sm hover:bg-accent"
          >
            重新扫描
          </button>
        ) : null}
        {runtime.connection === "connected" ? (
          <button
            type="button"
            onClick={handlePlcReset}
            aria-label="PLC复位"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-body-sm hover:bg-accent"
          >
            PLC复位
          </button>
        ) : null}
      </div>
    </div>
  );
};
