import { useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@shared/auth/types";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";

export type PasswordDialogSubmit = {
  oldPassword: string;
  newPassword: string;
  mustChangePassword: boolean;
};

type PasswordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** 改自己的密码要输原密码 */
  requireOldPassword?: boolean;
  /** 管理员重置别人密码时显示「下次登录需修改密码」 */
  showMustChange?: boolean;
  submitLabel?: string;
  /** 返回错误文案；成功返回 null（对话框随之关闭） */
  onSubmit: (values: PasswordDialogSubmit) => Promise<string | null>;
};

export const PasswordDialog = ({
  open,
  onOpenChange,
  title,
  description,
  requireOldPassword = false,
  showMustChange = false,
  submitLabel = "确定",
  onSubmit,
}: PasswordDialogProps) => {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMustChange(true);
    setError(null);
  }, [open]);

  const handleSubmit = async () => {
    if (busy) return;
    if (requireOldPassword && !oldPassword) {
      setError("请输入原密码");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit({
        oldPassword,
        newPassword,
        mustChangePassword: showMustChange && mustChange,
      });
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const setValueAndClear = (onChange: (value: string) => void, value: string) => {
    onChange(value);
    setError(null);
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    autoComplete: string,
  ) => (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => setValueAndClear(onChange, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void handleSubmit()}
        disabled={busy}
      />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          {requireOldPassword &&
            field("password-old", "原密码", oldPassword, setOldPassword, "current-password")}
          {field(
            "password-new",
            `新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`,
            newPassword,
            setNewPassword,
            "new-password",
          )}
          {field("password-confirm", "再次输入新密码", confirmPassword, setConfirmPassword, "new-password")}
          {showMustChange && (
            <Checkbox checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)}>
              下次登录需修改密码
            </Checkbox>
          )}
          {error && <p className="text-body-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-10 rounded-md border border-border px-4 text-body-sm text-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="h-10 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
