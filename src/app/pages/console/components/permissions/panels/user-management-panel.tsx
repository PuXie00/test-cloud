import { Pencil, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { cn } from "@/app/components/ui/utils";
import { PermissionMatrixTable } from "../permission-matrix";
import {
  MOCK_USERS,
  ROLE_FILTERS,
  ROLE_LABEL,
  cloneMatrix,
  getRolePreset,
} from "../permissions-constants";
import type { PermissionMatrix, RoleFilter, RoleId, UserRecord } from "../permissions-types";
import { UserListItem } from "../user-list-item";
import { UserAvatar } from "../user-avatar";

export const UserManagementPanel = () => {
  const [users] = useState<UserRecord[]>(MOCK_USERS);
  const [selectedId, setSelectedId] = useState(MOCK_USERS[0]?.id ?? "");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [customPermissions, setCustomPermissions] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<UserRecord>>>({});
  const [matrices, setMatrices] = useState<Record<string, PermissionMatrix>>(() =>
    Object.fromEntries(MOCK_USERS.map((u) => [u.id, cloneMatrix(getRolePreset(u.role))])),
  );

  const selected = users.find((u) => u.id === selectedId) ?? users[0];
  const draft = selected ? (drafts[selected.id] ?? {}) : {};
  const displayName = draft.displayName ?? selected?.displayName ?? "";
  const role = (draft.role ?? selected?.role ?? "tech") as RoleId;
  const email = draft.email ?? selected?.email ?? "";
  const matrix = selected ? matrices[selected.id] : getRolePreset("tech");

  const filteredUsers = useMemo(
    () => users.filter((u) => roleFilter === "all" || u.role === roleFilter),
    [users, roleFilter],
  );

  const updateDraft = (patch: Partial<UserRecord>) => {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], ...patch } }));
    if (patch.role && !customPermissions) {
      setMatrices((prev) => ({
        ...prev,
        [selected.id]: cloneMatrix(getRolePreset(patch.role as RoleId)),
      }));
    }
  };

  const handleMatrixChange = (next: PermissionMatrix) => {
    if (!selected) return;
    setMatrices((prev) => ({ ...prev, [selected.id]: next }));
  };

  const handleCustomToggle = (enabled: boolean) => {
    setCustomPermissions(enabled);
    if (!enabled && selected) {
      setMatrices((prev) => ({
        ...prev,
        [selected.id]: cloneMatrix(getRolePreset(role)),
      }));
    }
  };

  const handleDemoAction = (message: string) => {
    toast.message(message);
  };

  if (!selected) return null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[280px] shrink-0 flex-col bg-muted">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-label-caps text-foreground">用户列表</span>
          <Button
            type="button"
            size="sm"
            onClick={() => handleDemoAction("演示模式，暂不支持新建")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            添加用户
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredUsers.map((user) => (
            <UserListItem
              key={user.id}
              user={user}
              selected={user.id === selected.id}
              onSelect={() => setSelectedId(user.id)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1 px-3 py-2 text-sm">
          {ROLE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setRoleFilter(filter.id)}
              className={cn(
                "rounded-full px-2 py-1 text-label-caps transition-colors",
                roleFilter === filter.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <UserAvatar name={displayName} variant="detail" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-heading-md font-semibold text-foreground">{displayName}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-label-caps text-muted-foreground">
                  {ROLE_LABEL[role]}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-2 text-body-sm text-muted-foreground">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    selected.online ? "bg-show" : "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className={selected.online ? "text-show" : undefined}>
                  {selected.online ? "在线" : "离线"}
                </span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleDemoAction("演示模式，暂不支持编辑")}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              编辑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleDemoAction("演示模式，暂不支持重置密码")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              重置密码
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-label-caps text-muted-foreground">用户名</span>
            <Input readOnly value={selected.username} className="font-mono tabular-nums" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-caps text-muted-foreground">显示名</span>
            <Input
              value={displayName}
              onChange={(e) => updateDraft({ displayName: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-caps text-muted-foreground">角色</span>
            <Select value={role} onValueChange={(v) => updateDraft({ role: v as RoleId })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">管理员</SelectItem>
                <SelectItem value="tech">技术员</SelectItem>
                <SelectItem value="operator">操作员</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-caps text-muted-foreground">邮箱</span>
            <Input value={email} onChange={(e) => updateDraft({ email: e.target.value })} />
          </label>
        </div>

        <div className="my-6 h-px bg-muted" role="separator" />

        <div className="flex flex-col gap-3">
          <span className="text-label-caps text-foreground">功能权限</span>
          <PermissionMatrixTable
            value={matrix}
            onChange={handleMatrixChange}
            readOnly={!customPermissions}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-body-sm text-muted-foreground">
              基于角色：{ROLE_LABEL[role]}（预设权限）
            </span>
            <label className="flex items-center gap-2 text-body-sm text-foreground">
              <Switch checked={customPermissions} onCheckedChange={handleCustomToggle} />
              自定义权限
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
