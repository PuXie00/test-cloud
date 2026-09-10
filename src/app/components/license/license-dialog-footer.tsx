import { Headphones } from "lucide-react";

type LicenseDialogFooterProps = {
  isActivated: boolean;
  onConfirm: () => void;
};

export const LicenseDialogFooter = ({ isActivated, onConfirm }: LicenseDialogFooterProps) => (
  <div className="flex items-center justify-between border-t border-border pt-4">
    <button
      type="button"
      className="inline-flex items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground"
      onClick={() => {
        /* 占位：联系技术支持 */
      }}
    >
      <Headphones className="h-4 w-4" aria-hidden />
      联系技术支持
    </button>
    <button
      type="button"
      disabled={!isActivated}
      onClick={onConfirm}
      className="h-10 min-w-24 rounded-md bg-primary px-6 text-body-md font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      确定
    </button>
  </div>
);
