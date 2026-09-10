import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import { useLicense } from "@/app/license/use-license";
import { LicenseActivatePanel } from "./license-activate-panel";
import { LicenseDialogFooter } from "./license-dialog-footer";
import { LicenseDialogTabs, type LicenseDialogTab } from "./license-dialog-tabs";
import { LicenseInfoPanel } from "./license-info-panel";

export type SoftwareLicenseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible?: boolean;
  defaultTab?: LicenseDialogTab;
  onActivated?: () => void;
};

export const SoftwareLicenseDialog = ({
  open,
  onOpenChange,
  dismissible = true,
  defaultTab = "info",
  onActivated,
}: SoftwareLicenseDialogProps) => {
  const { isActivated, license } = useLicense();
  const [tab, setTab] = useState<LicenseDialogTab>(defaultTab);

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  const handleOpenChange = (next: boolean) => {
    if (!next && !dismissible) return;
    onOpenChange(next);
  };

  const handleActivated = () => {
    setTab("info");
    onActivated?.();
  };

  const handleConfirm = () => {
    if (!isActivated) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
          className={cn(
            "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 flex w-full max-w-[720px] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
          )}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          aria-describedby={undefined}
        >
          <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <DialogTitle className="text-heading-lg font-semibold text-foreground">
                软件授权管理
              </DialogTitle>
            </div>
            {dismissible && (
              <DialogPrimitive.Close
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            )}
          </div>

          <DialogDescription className="sr-only">管理软件授权与激活状态</DialogDescription>

          <LicenseDialogTabs active={tab} onChange={setTab} />

          <div className="min-h-[320px] px-6 py-4">
            {tab === "info" ? (
              <LicenseInfoPanel license={license} />
            ) : (
              <LicenseActivatePanel onSuccess={handleActivated} />
            )}
          </div>

          <div className="px-6 pb-6">
            <LicenseDialogFooter isActivated={isActivated} onConfirm={handleConfirm} />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
