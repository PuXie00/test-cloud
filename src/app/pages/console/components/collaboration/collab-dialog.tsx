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
import {
  COLLAB_TABS,
  createDefaultCollaborationState,
  createDefaultPrimaryBackupState,
  DEFAULT_COLLAB_TAB,
} from "./collab-constants";
import { COLLAB_SURFACES } from "./collab-surfaces";
import type { CollaborationState, CollabTabId, PrimaryBackupState } from "./collab-types";
import { CollaborationPanel } from "./panels/collaboration-panel";
import { PrimaryBackupPanel } from "./panels/primary-backup-panel";

export type CollabDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const CollabDialog = ({ open, onOpenChange }: CollabDialogProps) => {
  const [activeTab, setActiveTab] = useState<CollabTabId>(DEFAULT_COLLAB_TAB);
  const [primaryBackupState, setPrimaryBackupState] = useState<PrimaryBackupState>(
    createDefaultPrimaryBackupState,
  );
  const [collaborationState, setCollaborationState] = useState<CollaborationState>(
    createDefaultCollaborationState,
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab(DEFAULT_COLLAB_TAB);
    setPrimaryBackupState(createDefaultPrimaryBackupState());
    setCollaborationState(createDefaultCollaborationState());
  }, [open]);

  const handleSave = () => {
    toast.success("配置已保存（演示）");
    onOpenChange(false);
  };

  const renderPanel = () => {
    switch (activeTab) {
      case "primary-backup":
        return (
          <PrimaryBackupPanel state={primaryBackupState} onChange={setPrimaryBackupState} />
        );
      case "collaboration":
        return (
          <CollaborationPanel state={collaborationState} onChange={setCollaborationState} />
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            COLLAB_SURFACES.shell,
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "fixed top-[50%] left-[50%] z-50 flex h-[680px] w-full max-w-[960px] max-h-[calc(100vh-2rem)]",
            "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg",
            "shadow-[0_4px_24px_rgba(0,0,0,0.4)] duration-200 outline-none",
          )}
          aria-describedby={undefined}
        >
          <div className={cn("flex h-12 shrink-0 items-center justify-between px-4", COLLAB_SURFACES.chrome)}>
            <DialogTitle className="text-heading-lg font-semibold text-foreground">
              多主机协作
            </DialogTitle>
            <DialogPrimitive.Close
              className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <DialogDescription className="sr-only">
            多主机冗余备份与多用户协作管理
          </DialogDescription>

          <TabBar
            tabs={COLLAB_TABS}
            active={activeTab}
            onChange={setActiveTab}
            variant="underline"
            className={COLLAB_SURFACES.tabBar}
          />

          <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", COLLAB_SURFACES.content)}>
            {renderPanel()}
          </div>

          <div className={cn("flex h-12 shrink-0 items-center flex-row-reverse px-4", COLLAB_SURFACES.chrome)}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleSave}>
              保存配置
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
