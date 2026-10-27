import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { LicenseState } from "@shared/csocket/license";
import { cn } from "@/app/components/ui/utils";
import { licenseDate, licenseStatusLabel } from "@/app/license/license-labels";
import { useLicense } from "@/app/license/use-license";

const badgeClass = (state: LicenseState) => {
  const status = state.info?.status;
  if (status === "valid") return "border-show/40 bg-show/10 text-show";
  if (status === "expired") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-warning/40 bg-warning-surface text-warning";
};

export const LicenseStatusBadge = ({ state }: { state: LicenseState }) => (
  <span
    className={cn(
      "inline-flex h-8 w-fit items-center gap-2 rounded-md border px-3 text-body-sm",
      badgeClass(state),
    )}
  >
    授权{licenseStatusLabel(state)}
  </span>
);

/** 授权信息（来自 C++）+ 手动联网校验 */
export const LicenseInfoPanel = () => {
  const { state, verify } = useLicense();
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const info = state.info;

  const handleVerify = async () => {
    setVerifying(true);
    setNotice(null);
    const result = await verify();
    setVerifying(false);
    const ok = result.success;
    setNotice({ ok, text: result.message || (ok ? "校验完成" : "联网校验失败") });
  };

  const rows = [
    { label: "激活时间", value: info?.activatedAt },
    { label: "到期时间", value: info?.expireAt },
    { label: "离线可用至", value: info?.graceUntil },
  ];

  return (
    <div className="flex flex-col gap-5 py-2">
      <LicenseStatusBadge state={state} />

      <div className="overflow-hidden rounded-md">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={cn(
              "grid grid-cols-2 gap-4 px-3 py-3",
              index % 2 === 0 ? "bg-muted/40" : "bg-background",
            )}
          >
            <span className="text-label-caps text-muted-foreground">{row.label}</span>
            <span className="font-mono text-mono-md tabular-nums text-foreground">{licenseDate(row.value)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying}
          className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-accent px-4 text-body-md text-foreground hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {verifying ? "正在联网校验…" : "联网校验"}
        </button>
        {notice && (
          <p
            className={cn("text-body-sm", notice.ok ? "text-muted-foreground" : "text-destructive")}
            role="status"
            aria-live="polite"
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
};
