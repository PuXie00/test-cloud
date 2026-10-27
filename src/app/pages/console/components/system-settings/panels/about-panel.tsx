import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { LicenseManageButton } from "@/app/components/license";
import { buttonVariants } from "@/app/components/ui/button";
import { licenseDate, licenseStatusLabel } from "@/app/license/license-labels";
import { useLicense } from "@/app/license/use-license";
import { SOFTWARE_INFO } from "../system-settings-constants";
import { SettingsSection } from "../settings-section";

const InfoRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="text-label-caps text-muted-foreground">{label}</span>
    <span className="text-body-md text-foreground">{value}</span>
  </div>
);

const MonoValue = ({ value }: { value: string | undefined }) => (
  <span className="font-mono tabular-nums">{licenseDate(value)}</span>
);

export const AboutPanel = () => {
  const { state } = useLicense();
  const info = state.info;
  const valid = info?.status === "valid";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <SettingsSection title="软件信息">
        <div className="rounded-md bg-card p-4">
          <div className="flex flex-col gap-2">
            <span className="text-heading-md font-semibold text-foreground">
              {SOFTWARE_INFO.softwareName}
            </span>
            <span className="font-mono text-mono-md tabular-nums text-muted-foreground">
              {SOFTWARE_INFO.version}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="授权信息">
        <div className="rounded-md bg-muted p-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoRow
              label="授权状态"
              value={
                <span className="inline-flex items-center gap-2">
                  <span className={valid ? "h-2 w-2 rounded-full bg-show" : "h-2 w-2 rounded-full bg-warning"} aria-hidden />
                  {licenseStatusLabel(state)}
                </span>
              }
            />
            <InfoRow label="激活时间" value={<MonoValue value={info?.activatedAt} />} />
            <InfoRow label="到期日期" value={<MonoValue value={info?.expireAt} />} />
            <InfoRow label="离线可用至" value={<MonoValue value={info?.graceUntil} />} />
          </div>
          {/* 和登录页的「授权管理」是同一个对话框 */}
          <div className="mt-4 flex justify-end">
            <LicenseManageButton className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ShieldCheck className="h-4 w-4" aria-hidden />
              授权管理
            </LicenseManageButton>
          </div>
        </div>
      </SettingsSection>

      <p className="text-body-sm text-muted-foreground">{SOFTWARE_INFO.copyright}</p>
    </div>
  );
};
