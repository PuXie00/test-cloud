import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PERMISSION_GROUPS } from "@shared/auth/permissions";
import type { DisplayLengthUnitPreference } from "@shared/auth/types";
import { useAuth } from "@/app/auth/use-auth";
import { PasswordDialog } from "@/app/components/auth/password-dialog";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { parseDisplayLengthUnit } from "@/app/project/display-length-units";
import { useConsoleLogin } from "../../login-overlay/console-login-context";
import { UserAvatar } from "../../permissions/user-avatar";
import { SettingsFieldRow } from "../settings-field-row";
import { SettingsSection } from "../settings-section";

const DISPLAY_UNIT_OPTIONS: { value: DisplayLengthUnitPreference; label: string }[] = [
  { value: "m", label: "米" },
  { value: "cm", label: "厘米" },
  { value: "mm", label: "毫米" },
  { value: "in", label: "英寸" },
];

export const formatAuthTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
};

type UserPanelProps = {
  /** 切换用户 / 退出登录前先关掉设置对话框（登录框在它外面） */
  onRequestClose: () => void;
};

/** 系统设置 →「用户」：当前用户信息、改密码、切换 / 退出、偏好设置、我的权限 */
export const UserPanel = ({ onRequestClose }: UserPanelProps) => {
  const { session, changePassword, updatePreferences } = useAuth();
  const { openSwitchUser, logoutInPlace } = useConsoleLogin();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [savingUnit, setSavingUnit] = useState(false);

  if (!session) return null;
  const { user, role } = session;

  const handleUnitChange = async (next: DisplayLengthUnitPreference) => {
    if (next === user.preferences.displayLengthUnit || savingUnit) return;
    setSavingUnit(true);
    try {
      const result = await updatePreferences({ displayLengthUnit: next });
      if (!result.ok) toast.error(result.message);
    } finally {
      setSavingUnit(false);
    }
  };

  const grantedGroups = PERMISSION_GROUPS.map((group) => ({
    label: group.label,
    points: group.points.filter((point) => session.permissions.includes(point.id)),
  })).filter((group) => group.points.length > 0);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <SettingsSection title="当前用户">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-muted/30 p-4">
          <div className="flex min-w-0 items-center gap-4">
            <UserAvatar name={user.displayName} variant="detail" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-heading-md font-semibold text-foreground">
                  {user.displayName}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-label-caps text-muted-foreground">
                  {role.name}
                </span>
              </div>
              <p className="mt-1 text-body-sm text-muted-foreground">
                用户名 <span className="font-mono text-foreground">{user.username}</span>
              </p>
              <p className="text-body-sm text-muted-foreground">
                本次登录 <span className="font-mono tabular-nums">{formatAuthTime(session.loggedInAt)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4" aria-hidden />
              修改密码
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onRequestClose();
                openSwitchUser();
              }}
            >
              <UserRound className="h-4 w-4" aria-hidden />
              切换用户
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                onRequestClose();
                void logoutInPlace();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              退出登录
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="偏好设置">
        <SettingsFieldRow label="显示单位">
          <RadioGroup
            value={user.preferences.displayLengthUnit}
            onValueChange={(v) => void handleUnitChange(parseDisplayLengthUnit(v))}
            className="flex flex-row gap-4"
            disabled={savingUnit}
          >
            {DISPLAY_UNIT_OPTIONS.map((item) => (
              <div key={item.value} className="flex items-center gap-2">
                <RadioGroupItem value={item.value} id={`user-unit-${item.value}`} />
                <Label
                  htmlFor={`user-unit-${item.value}`}
                  className="cursor-pointer text-body-md normal-case tracking-normal text-muted-foreground peer-data-[state=checked]:text-foreground"
                >
                  {item.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </SettingsFieldRow>
        <p className="text-body-sm text-muted-foreground">
          偏好跟着用户走：立即生效，换人登录后按对方的设置显示。
        </p>
      </SettingsSection>

      <SettingsSection title="我的权限">
        <div className="flex flex-col gap-3 rounded-md bg-muted/30 p-4">
          <p className="text-body-sm text-muted-foreground">
            角色「{role.name}」
            {session.isAdmin ? "：全部权限，外加用户与权限管理" : "。没有的权限对应的按钮不会显示。"}
          </p>
          {!session.isAdmin &&
            (grantedGroups.length === 0 ? (
              <p className="text-body-sm text-foreground">只有基础功能（查看控制页、急停、停止）</p>
            ) : (
              grantedGroups.map((group) => (
                <div key={group.label} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 shrink-0 text-label-caps text-muted-foreground">{group.label}</span>
                  {group.points.map((point) => (
                    <span
                      key={point.id}
                      className="rounded-full bg-card px-2 py-0.5 text-body-sm text-foreground"
                      title={point.description}
                    >
                      {point.label}
                    </span>
                  ))}
                </div>
              ))
            ))}
        </div>
      </SettingsSection>

      <PasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        title="修改密码"
        requireOldPassword
        submitLabel="修改"
        onSubmit={async ({ oldPassword, newPassword }) => {
          const result = await changePassword({ oldPassword, newPassword });
          if (!result.ok) return result.message;
          toast.success("密码已修改");
          return null;
        }}
      />
    </div>
  );
};
