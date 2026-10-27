import { useState, type ReactNode } from "react";
import { SoftwareLicenseDialog } from "./software-license-dialog";

type LicenseManageButtonProps = {
  className?: string;
  children?: ReactNode;
};

/** 「授权管理」：登录页和系统设置「关于软件」共用同一个对话框（查看授权、联网校验、换码续期） */
export const LicenseManageButton = ({ className, children = "授权管理" }: LicenseManageButtonProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <SoftwareLicenseDialog open={open} onOpenChange={setOpen} dismissible defaultTab="info" />
    </>
  );
};
