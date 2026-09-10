import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TabBar } from "@/app/components/ics/tab-bar";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/components/ui/utils";
import { RoleConfigPanel } from "./panels/role-config-panel";
import { SecurityPolicyPanel } from "./panels/security-policy-panel";
import { UserManagementPanel } from "./panels/user-management-panel";
import { DEFAULT_PERMISSIONS_TAB, PERMISSION_TABS } from "./permissions-constants";
import type { PermissionsTabId } from "./permissions-types";

export type PermissionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const renderPanel = (tabId: PermissionsTabId) => {
  switch (tabId) {
    case "users":
      return <UserManagementPanel />;
    case "roles":
      return <RoleConfigPanel />;
    case "security":
      return <SecurityPolicyPanel />;
  }
};

export const PermissionsDialog = ({ open, onOpenChange }: PermissionsDialogProps) => {
  const [activeTab, setActiveTab] = useState<PermissionsTabId>(DEFAULT_PERMISSIONS_TAB);

  useEffect(() => {
    if (open) setActiveTab(DEFAULT_PERMISSIONS_TAB);
  }, [open]);

  const handleSave = () => {
    toast.success("修改已保存（演示）");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            "bg-card data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "fixed top-[50%] left-[50%] z-50 flex h-[680px] w-full max-w-[960px] max-h-[calc(100vh-2rem)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg",
            "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
          )}
          aria-describedby={undefined}
        >
          <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
            <DialogTitle className="text-heading-lg font-semibold text-foreground">
              权限与用户管理
            </DialogTitle>
            <DialogPrimitive.Close
              className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <DialogDescription className="sr-only">管理用户账号、角色权限与安全策略</DialogDescription>

          <TabBar tabs={PERMISSION_TABS} active={activeTab} onChange={setActiveTab} variant="underline" />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderPanel(activeTab)}</div>

          <div className="flex h-12 shrink-0 items-center flex-row-reverse bg-muted px-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleSave}>
              保存修改
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
