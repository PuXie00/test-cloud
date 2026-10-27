import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@shared/auth/types";
import { useAuth } from "@/app/auth/use-auth";
import { PasswordDialog } from "@/app/components/auth/password-dialog";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { formatAuthTime } from "../../system-settings/panels/user-panel";
import { PermissionChecklist } from "../permission-checklist";
import type { UserAdmin } from "../use-user-admin";
import { UserAvatar } from "../user-avatar";
import { UserListItem } from "../user-list-item";

/** 对话框里控件上方的标签（设计规范：body-sm、次要文字色） */
const labelClass = "text-body-sm text-muted-foreground";

type CreateUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin: UserAdmin;
  onCreated: (id: string) => void;
};

const CreateUserDialog = ({ open, onOpenChange, admin, onCreated }: CreateUserDialogProps) => {
  const defaultRoleId = admin.roles.find((role) => !role.builtin)?.id ?? admin.roles[0]?.id ?? "";
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername("");
    setDisplayName("");
    setRoleId(defaultRoleId);
    setPassword("");
    setConfirm("");
    setMustChange(true);
    setError(null);
    // 只在打开时重置，角色列表刷新不打断正在填的表单
  }, [open]);

  const handleCreate = async () => {
    if (busy) return;
    if (!username.trim() || !displayName.trim()) {
      setError("请填写用户名和显示名");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const created = await admin.run(
        () =>
          window.authAPI?.createUser({
            username,
            displayName,
            roleId,
            password,
            mustChangePassword: mustChange,
          }),
        `已添加用户「${displayName.trim()}」`,
      );
      if (created) {
        onCreated(created.data.id);
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>添加用户</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>用户名（登录用）</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>显示名</span>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={busy} />
          </label>
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className={labelClass}>角色</span>
            <Select
              value={roleId}
              onValueChange={setRoleId}
              aria-label="角色"
              options={admin.roles.map((role) => ({ value: role.id, label: role.name }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>初始密码</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>再次输入</span>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} />
          </label>
          <div className="col-span-2">
            <Checkbox checked={mustChange} onCheckedChange={(v) => setMustChange(v === true)}>
              首次登录需修改密码
            </Checkbox>
          </div>
          {error && <p className="col-span-2 text-body-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={busy}>
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** 用户：增删改、停用、重置密码；改动立即生效 */
export const UserManagementPanel = ({ admin }: { admin: UserAdmin }) => {
  const { user: currentUser } = useAuth();
  const { users, roles, run } = admin;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;
  const [displayNameDraft, setDisplayNameDraft] = useState("");

  useEffect(() => {
    setDisplayNameDraft(selected?.displayName ?? "");
  }, [selected?.id, selected?.displayName]);

  const roleName = (roleId: string) => roles.find((role) => role.id === roleId)?.name ?? "未知角色";
  const isSelf = selected?.id === currentUser?.id;
  const selectedRole = roles.find((role) => role.id === selected?.roleId);

  const commitDisplayName = async () => {
    if (!selected) return;
    const next = displayNameDraft.trim();
    if (next === selected.displayName) return;
    const updated = await run(() => window.authAPI?.updateUser({ id: selected.id, displayName: next }));
    if (!updated) setDisplayNameDraft(selected.displayName);
  };

  const handleDelete = async () => {
    if (!selected) return;
    const ok = await window.toolAPI.confirm({
      title: "删除用户",
      message: `确认删除用户「${selected.displayName}」？`,
      detail: "删除后不能恢复；操作日志里的记录保留。",
      danger: true,
    });
    if (!ok) return;
    const done = await run(() => window.authAPI?.deleteUser({ id: selected.id }), "用户已删除");
    if (done) setSelectedId(null);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[280px] shrink-0 flex-col bg-muted">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-label-caps text-foreground">用户列表</span>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            添加用户
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {users.map((user) => (
            <UserListItem
              key={user.id}
              user={user}
              roleName={roleName(user.roleId)}
              isCurrent={user.id === currentUser?.id}
              selected={user.id === selected?.id}
              onSelect={() => setSelectedId(user.id)}
            />
          ))}
        </div>
      </aside>

      {selected ? (
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <UserAvatar name={selected.displayName} variant="detail" />
              <div>
                <h3 className="text-heading-md font-semibold text-foreground">{selected.displayName}</h3>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {roleName(selected.roleId)}
                  {isSelf ? " · 当前登录" : ""}
                  {selected.enabled ? "" : " · 已停用"}
                </p>
              </div>
            </div>
            {!isSelf && (
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  重置密码
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => void handleDelete()}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  删除
                </Button>
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>用户名</span>
              <Input readOnly value={selected.username} className="font-mono" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>显示名</span>
              <Input
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                onBlur={() => void commitDisplayName()}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>角色</span>
              <Select
                value={selected.roleId}
                disabled={isSelf}
                aria-label="角色"
                onValueChange={(roleId) => void run(() => window.authAPI?.updateUser({ id: selected.id, roleId }))}
                options={roles.map((role) => ({ value: role.id, label: role.name }))}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>启用</span>
              <div className="flex h-9 items-center gap-2">
                <Switch
                  checked={selected.enabled}
                  disabled={isSelf}
                  aria-label="启用"
                  onCheckedChange={(enabled) =>
                    void run(() => window.authAPI?.updateUser({ id: selected.id, enabled }))
                  }
                />
                <span className="text-body-sm text-muted-foreground">
                  {selected.enabled ? "可以登录" : "已停用，不能登录"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>创建时间</span>
              <span className="font-mono text-body-sm tabular-nums text-foreground">
                {formatAuthTime(selected.createdAt)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>上次登录</span>
              <span className="font-mono text-body-sm tabular-nums text-foreground">
                {formatAuthTime(selected.lastLoginAt)}
              </span>
            </div>
          </div>
          {isSelf && (
            <p className="mt-3 text-body-sm text-muted-foreground">
              不能修改自己的角色或停用自己；自己的密码在「系统设置 → 用户」里修改。
            </p>
          )}

          <div className="my-6 h-px bg-muted" role="separator" />

          <div className="flex flex-col gap-3">
            <span className="text-label-caps text-foreground">
              角色「{roleName(selected.roleId)}」的权限（在「角色」页修改）
            </span>
            {selectedRole?.builtin ? (
              <p className="text-body-sm text-muted-foreground">全部权限，外加用户与权限管理。</p>
            ) : (
              <PermissionChecklist value={selectedRole?.permissions ?? []} readOnly />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-body-sm text-muted-foreground">
          {admin.loading ? "正在读取…" : "没有用户"}
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} admin={admin} onCreated={setSelectedId} />
      {selected && (
        <PasswordDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title={`重置「${selected.displayName}」的密码`}
          showMustChange
          submitLabel="重置"
          onSubmit={async ({ newPassword, mustChangePassword }) => {
            const done = await run(
              () => window.authAPI?.resetPassword({ id: selected.id, password: newPassword, mustChangePassword }),
              "密码已重置",
            );
            return done ? null : "重置失败";
          }}
        />
      )}
    </div>
  );
};
