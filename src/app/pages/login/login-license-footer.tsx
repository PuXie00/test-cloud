import { useLicense } from "@/app/license/use-license";

type LoginLicenseFooterProps = {
  onActivate: () => void;
};

export const LoginLicenseFooter = ({ onActivate }: LoginLicenseFooterProps) => {
  const { isActivated, license } = useLicense();

  return (
    <footer className="mt-6 flex items-center justify-between border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <span
          className={
            isActivated
              ? "h-2 w-2 rounded-full bg-show shadow-[0_0_8px] shadow-show/80"
              : "h-2 w-2 rounded-full bg-muted-foreground"
          }
          aria-hidden
        />
        <span className="text-body-sm text-muted-foreground">
          授权状态：{isActivated ? "已激活" : "未激活"}
        </span>
      </div>
      {isActivated && license ? (
        <span className="font-mono text-mono-sm text-muted-foreground">
          到期：{license.expiresAt}
        </span>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          className="text-body-sm font-medium text-primary hover:text-primary/80"
        >
          去激活
        </button>
      )}
    </footer>
  );
};
