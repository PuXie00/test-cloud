import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { LICENSE_DISPLAY } from "../system-settings-constants";
import { SettingsSection } from "../settings-section";

const InfoRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-label-caps text-muted-foreground">{label}</span>
    <span className="text-body-md text-foreground">{value}</span>
  </div>
);

export const AboutPanel = () => {
  const handleCopyHardwareId = async () => {
    try {
      await navigator.clipboard.writeText(LICENSE_DISPLAY.hardwareId);
    } catch {
      // clipboard unavailable in some contexts
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SettingsSection title="软件信息">
        <div className="rounded-md bg-card p-4">
          <div className="flex flex-col gap-2">
            <span className="text-heading-md font-semibold text-foreground">
              {LICENSE_DISPLAY.softwareName}
            </span>
            <span className="font-mono text-mono-md tabular-nums text-muted-foreground">
              {LICENSE_DISPLAY.version}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="授权信息">
        <div className="rounded-md bg-muted p-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="授权版本" value={<Badge variant="default">{LICENSE_DISPLAY.edition}</Badge>} />
            <InfoRow
              label="授权状态"
              value={
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                  {LICENSE_DISPLAY.status}
                </span>
              }
            />
            <InfoRow label="授权对象" value={LICENSE_DISPLAY.licensedTo} />
            <InfoRow
              label="到期日期"
              value={
                <span className="font-mono tabular-nums">{LICENSE_DISPLAY.expiresAt}</span>
              }
            />
            <InfoRow label="功能模块" value={LICENSE_DISPLAY.features} />
            <InfoRow
              label="设备上限"
              value={<span className="font-mono tabular-nums">{LICENSE_DISPLAY.deviceLimit} 台</span>}
            />
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-label-caps text-muted-foreground">硬件码</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-mono-md tabular-nums text-foreground">
                  {LICENSE_DISPLAY.hardwareId}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyHardwareId}
                  aria-label="复制硬件码"
                >
                  <Copy className="h-4 w-4" aria-hidden />
                  复制
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>

      <p className="text-body-sm text-muted-foreground">{LICENSE_DISPLAY.copyright}</p>
    </div>
  );
};
