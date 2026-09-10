import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { cn } from "@/app/components/ui/utils";
import { AboutPanel } from "./panels/about-panel";
import { CalibrationPanel } from "./panels/calibration-panel";
import { InterfaceSettingsPanel } from "./panels/interface-settings-panel";
import { NetworkSettingsPanel } from "./panels/network-settings-panel";
import { NotificationsPanel } from "./panels/notifications-panel";
import { SettingsNavItem } from "./settings-nav-item";
import {
  DEFAULT_SETTINGS_NAV,
  LICENSE_DISPLAY,
  SETTINGS_NAV_ITEMS,
} from "./system-settings-constants";
import type { SettingsNavId } from "./system-settings-types";

export type SystemSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const renderPanel = (navId: SettingsNavId) => {
  switch (navId) {
    case "interface":
      return <InterfaceSettingsPanel />;
    case "calibration":
      return <CalibrationPanel />;
    case "network":
      return <NetworkSettingsPanel />;
    case "notifications":
      return <NotificationsPanel />;
    case "about":
      return <AboutPanel />;
  }
};

export const SystemSettingsDialog = ({ open, onOpenChange }: SystemSettingsDialogProps) => {
  const [activeNav, setActiveNav] = useState<SettingsNavId>(DEFAULT_SETTINGS_NAV);

  useEffect(() => {
    if (open) setActiveNav(DEFAULT_SETTINGS_NAV);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "fixed top-[50%] left-[50%] z-50 flex h-[680px] w-full max-w-[920px] max-h-[calc(100vh-2rem)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg",
            "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
          )}
          aria-describedby={undefined}
        >
          <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
            <div className="flex min-w-0 flex-1 items-center gap-6">
              <DialogTitle className="shrink-0 text-heading-lg font-semibold text-foreground">
                系统设置
              </DialogTitle>
              <span className="truncate text-body-sm text-muted-foreground">
                {LICENSE_DISPLAY.edition} · {LICENSE_DISPLAY.status} ·{" "}
                <span className="font-mono tabular-nums">{LICENSE_DISPLAY.expiresAt}</span>
              </span>
            </div>
            <DialogPrimitive.Close
              className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <DialogDescription className="sr-only">系统全局配置与控台校准</DialogDescription>

          <div className="flex min-h-0 flex-1">
            <nav className="flex w-[200px] shrink-0 flex-col gap-1 bg-background p-2" aria-label="设置分类">
              {SETTINGS_NAV_ITEMS.map((item) => (
                <SettingsNavItem
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  active={activeNav === item.id}
                  onClick={() => setActiveNav(item.id)}
                />
              ))}
            </nav>

            <ScrollArea className="min-h-0 bg-card flex-1">
              <div className="p-6">{renderPanel(activeNav)}</div>
            </ScrollArea>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
