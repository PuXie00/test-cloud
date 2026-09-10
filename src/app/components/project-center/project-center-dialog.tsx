import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
} from "@/app/components/ui/dialog";
import { ProjectCenterScreen } from "./project-center-screen";

type ProjectCenterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Console 内全屏工程管理弹窗（不跳转路由） */
export const ProjectCenterDialog = ({ open, onOpenChange }: ProjectCenterDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogOverlay className="bg-background" />
      <DialogPrimitive.Content
        data-slot="project-center-fullscreen"
        className="fixed inset-0 z-50 flex h-dvh w-screen flex-col bg-background outline-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogPrimitive.Title className="sr-only">工程中心</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          管理本地工程：打开、新建、导入导出与版本恢复
        </DialogPrimitive.Description>
        <div className="flex h-full min-h-0 w-full flex-1 flex-col">
          <ProjectCenterScreen
            presentation="overlay"
            onDismiss={() => onOpenChange(false)}
          />
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>
);
