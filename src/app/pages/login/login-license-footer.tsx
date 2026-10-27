import { licenseDate, licenseStatusLabel } from "@/app/license/license-labels";
import { useLicense } from "@/app/license/use-license";

type LoginLicenseFooterProps = {
  onManage: () => void;
};

export const LoginLicenseFooter = ({ onManage }: LoginLicenseFooterProps) => {
  const { state } = useLicense();
  const valid = state.info?.status === "valid";

  return (
    <footer className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <span
          className={
            valid
              ? "h-2 w-2 rounded-full bg-show shadow-[0_0_8px] shadow-show/80"
              : "h-2 w-2 rounded-full bg-warning"
          }
          aria-hidden
        />
        <span className="text-body-sm text-muted-foreground">授权状态：{licenseStatusLabel(state)}</span>
      </div>
      <div className="flex items-center gap-3">
        {state.info?.expireAt && (
          <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
            到期：{licenseDate(state.info.expireAt)}
          </span>
        )}
        <button
          type="button"
          onClick={onManage}
          className="min-h-10 px-2 text-body-sm font-medium text-primary hover:text-primary/80"
        >
          授权管理
        </button>
      </div>
    </footer>
  );
};
