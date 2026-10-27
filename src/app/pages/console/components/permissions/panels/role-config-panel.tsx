import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PermissionId } from "@shared/auth/permissions";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { PermissionChecklist } from "../permission-checklist";
import { RoleListItem } from "../role-list-item";
import type { UserAdmin } from "../use-user-admin";

/** 对话框里控件上方的标签（设计规范：body-sm、次要文字色） */
const labelClass = "text-body-sm text-muted-foreground";
const BLANK = "__blank__";

type CreateRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin: UserAdmin;
  /** 「复制为新角色」时预选的来源 */
  copyFromId: string | null;
  onCreated: (id: string) => void;
};

const CreateRoleDialog = ({ open, onOpenChange, admin, copyFromId, onCreated }: CreateRoleDialogProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const source = admin.roles.find((role) => role.id === copyFromId);
    setName(source ? `${source.name}_副本` : "");
    setDescription(source?.description ?? "");
    setSourceId(source?.id ?? BLANK);
    // 只在打开时重置
  }, [open]);

  const handleCreate = async () => {
    if (busy) return;
    const source = admin.roles.find((role) => role.id === sourceId);
    setBusy(true);
    try {
      const created = await admin.run(
        () =>
          window.authAPI?.createRole({
            name,
            description,
            permissions: source ? [...source.permissions] : [],
          }),
        `已新建角色「${name.trim()}」`,
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
          <DialogTitle>新建角色</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>角色名称</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>说明</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>权限</span>
            <Select
              value={sourceId}
              onValueChange={setSourceId}
              aria-label="权限来源"
              options={[
                { value: BLANK, label: "空白（之后再勾选）" },
                ...admin.roles.map((role) => ({ value: role.id, label: `复制「${role.name}」的权限` })),
              ]}
            />
          </label>
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={busy}>
            新建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** 角色：管理员内置不可改；其他角色的名称、说明、权限改了立即生效 */
export const RoleConfigPanel = ({ admin }: { admin: UserAdmin }) => {
  const { users, roles, run } = admin;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copyFromId, setCopyFromId] = useState<string | null>(null);
  const selected = roles.find((role) => role.id === selectedId) ?? roles[0] ?? null;
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setDescriptionDraft(selected?.description ?? "");
  }, [selected?.id, selected?.name, selected?.description]);

  const userCount = (roleId: string) => users.filter((user) => user.roleId === roleId).length;

  const commitText = async (field: "name" | "description", value: string) => {
    if (!selected || selected.builtin) return;
    if (value.trim() === selected[field]) return;
    const updated = await run(() => window.authAPI?.updateRole({ id: selected.id, [field]: value }));
    if (!updated) {
      setNameDraft(selected.name);
      setDescriptionDraft(selected.description);
    }
  };

  const handlePermissions = (permissions: PermissionId[]) => {
    if (!selected || selected.builtin) return;
    void run(() => window.authAPI?.updateRole({ id: selected.id, permissions }));
  };

  const handleDelete = async () => {
    if (!selected) return;
    const ok = await window.toolAPI.confirm({
      title: "删除角色",
      message: `确认删除角色「${selected.name}」？`,
      danger: true,
    });
    if (!ok) return;
    const done = await run(() => window.authAPI?.deleteRole({ id: selected.id }), "角色已删除");
    if (done) setSelectedId(null);
  };

  const inUse = selected ? userCount(selected.id) : 0;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[280px] shrink-0 flex-col bg-muted">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-label-caps text-foreground">角色列表</span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCopyFromId(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建角色
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {roles.map((role) => (
            <RoleListItem
              key={role.id}
              role={role}
              userCount={userCount(role.id)}
              selected={role.id === selected?.id}
              onSelect={() => setSelectedId(role.id)}
            />
          ))}
        </div>
      </aside>

      {selected ? (
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>角色名称</span>
                <Input
                  value={nameDraft}
                  disabled={selected.builtin}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void commitText("name", nameDraft)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>说明</span>
                <Input
                  value={descriptionDraft}
                  disabled={selected.builtin}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={() => void commitText("description", descriptionDraft)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </label>
            </div>
            <div className="flex gap-2 pt-5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCopyFromId(selected.id);
                  setCreateOpen(true);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
                复制为新角色
              </Button>
              {!selected.builtin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={inUse > 0}
                  title={inUse > 0 ? `还有 ${inUse} 个用户是这个角色，先把他们改到别的角色` : undefined}
                  onClick={() => void handleDelete()}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  删除
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 text-body-sm text-muted-foreground">
            {selected.builtin
              ? "管理员角色内置：全部权限，外加用户与权限管理，不能修改。"
              : `${inUse} 个用户是这个角色。勾选立即生效，这些用户下次登录或切换后按新权限显示。`}
            {!selected.builtin && inUse > 0 ? "（有用户在用，不能删除）" : ""}
          </p>

          <div className="my-6 h-px bg-muted" role="separator" />

          <PermissionChecklist
            value={selected.permissions}
            readOnly={selected.builtin}
            onChange={handlePermissions}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-body-sm text-muted-foreground">
          {admin.loading ? "正在读取…" : "没有角色"}
        </div>
      )}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        admin={admin}
        copyFromId={copyFromId}
        onCreated={setSelectedId}
      />
    </div>
  );
};
