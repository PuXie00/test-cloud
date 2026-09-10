import { AlertTriangle } from "lucide-react";
import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";

export const WizardSkipBanner = () => {
  const { skipConfirmPending } = useConfigWizard();
  if (!skipConfirmPending) return null;

  return (
    <div
      role="alert"
      className="flex h-10 shrink-0 items-center gap-2 bg-warning-surface px-4 text-body-sm text-warning"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      跳过硬件配置后，仅支持离线仿真。再次点击「跳过此步骤」确认。
    </div>
  );
};
