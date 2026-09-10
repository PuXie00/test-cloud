import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/components/ui/utils";
import type { LicenseRecord } from "@/app/license/license-types";

type LicenseInfoPanelProps = {
  license: LicenseRecord | null;
};

const INFO_ROWS: { label: string; key: keyof LicenseRecord }[] = [
  { label: "授权类型", key: "edition" },
  { label: "授权用户", key: "licensedTo" },
  { label: "到期日期", key: "expiresAt" },
  { label: "可用功能", key: "features" },
];

export const LicenseInfoPanel = ({ license }: LicenseInfoPanelProps) => {
  const [copied, setCopied] = useState(false);

  if (!license) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <span className="inline-flex h-8 w-fit items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 text-body-sm text-warning">
          未授权
        </span>
        <p className="text-body-sm text-muted-foreground">
          软件尚未激活。请切换到「激活授权」输入授权码完成激活。
        </p>
      </div>
    );
  }

  const handleCopyHardwareId = async () => {
    try {
      await navigator.clipboard.writeText(license.hardwareId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-show/40 bg-show/10 px-3 text-body-sm text-show">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          授权有效
        </span>
        <span className="text-body-md text-muted-foreground">
          {license.edition} · 全功能
        </span>
      </div>

      <div className="overflow-hidden rounded-md">
        {INFO_ROWS.map((row, index) => (
          <div
            key={row.key}
            className={cn(
              "grid grid-cols-2 gap-4 px-3 py-3",
              index % 2 === 0 ? "bg-muted/40" : "bg-background",
            )}
          >
            <span className="text-label-caps text-muted-foreground">{row.label}</span>
            <span
              className={cn(
                "text-body-md text-foreground",
                row.key === "expiresAt" && "font-mono text-primary",
              )}
            >
              {String(license[row.key])}
            </span>
          </div>
        ))}
        <div className={cn("grid grid-cols-2 gap-4 px-3 py-3", INFO_ROWS.length % 2 === 0 ? "bg-muted/40" : "bg-background")}>
          <span className="text-label-caps text-muted-foreground">设备数量上限</span>
          <span className="text-body-md text-foreground">{license.deviceLimit} 台</span>
        </div>
      </div>

      <div className="rounded-md bg-muted/50 p-3">
        <p className="mb-2 text-label-caps text-muted-foreground">硬件码</p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={license.hardwareId}
            className="font-mono text-mono-md"
            aria-readonly
          />
          <button
            type="button"
            onClick={handleCopyHardwareId}
            className="inline-flex shrink-0 items-center gap-1 px-2 text-body-sm text-primary hover:text-primary/80"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" aria-hidden />
                已复制
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden />
                复制
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
