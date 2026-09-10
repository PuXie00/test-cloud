import { useState } from "react";
import { useLicense } from "@/app/license/use-license";
import { Input } from "@/app/components/ui/input";

type LicenseActivatePanelProps = {
  onSuccess?: () => void;
};

export const LicenseActivatePanel = ({ onSuccess }: LicenseActivatePanelProps) => {
  const { activate } = useLicense();
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleActivate = () => {
    setError(null);
    if (!licenseKey.trim()) {
      setError("请输入授权码");
      return;
    }
    if (!activate(licenseKey)) {
      setError("授权码无效");
      return;
    }
    setLicenseKey("");
    onSuccess?.();
  };

  return (
    <div className="flex flex-col gap-4 py-2">
      <p className="text-body-sm text-muted-foreground">
        请输入厂商提供的授权码以激活本机软件。演示环境可使用授权码{" "}
        <span className="font-mono text-primary">YZDI-2026-DEMO</span>。
      </p>
      <div className="flex flex-col gap-2">
        <label htmlFor="license-key" className="text-label-caps text-muted-foreground">
          授权码
        </label>
        <Input
          id="license-key"
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
          placeholder="请输入授权码"
          className="h-11 font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleActivate();
            }
          }}
        />
      </div>
      <p className="min-h-[18px] text-body-sm text-destructive" role="alert" aria-live="polite">
        {error}
      </p>
      <button
        type="button"
        onClick={handleActivate}
        className="h-10 w-full rounded-md bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
      >
        激活
      </button>
    </div>
  );
};
