import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { PermissionMatrixTable } from "../permission-matrix";
import { ROLE_PRESETS, cloneMatrix } from "../permissions-constants";
import type { PermissionMatrix, RoleRecord } from "../permissions-types";
import { RoleListItem } from "../role-list-item";

export const RoleConfigPanel = () => {
  const [roles] = useState<RoleRecord[]>(ROLE_PRESETS);
  const [selectedId, setSelectedId] = useState<RoleRecord["id"]>("tech");
  const [matrices, setMatrices] = useState<Record<string, PermissionMatrix>>(() =>
    Object.fromEntries(roles.map((r) => [r.id, cloneMatrix(r.permissions)])),
  );

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0];
  const matrix = matrices[selected.id];

  const handleDemo = (message: string) => toast.message(message);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[280px] shrink-0 flex-col bg-muted">
        <p className="px-3 py-3 text-body-sm text-muted-foreground">
          角色为系统预设，本迭代不可新建自定义角色
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {roles.map((role) => (
            <RoleListItem
              key={role.id}
              role={role}
              selected={role.id === selected.id}
              onSelect={() => setSelectedId(role.id)}
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <h3 className="text-heading-md font-semibold text-foreground">
          角色详情 — {selected.label}
        </h3>
        <p className="mt-2 text-body-sm text-muted-foreground">{selected.description}</p>

        <div className="my-6 h-px bg-muted" role="separator" />

        <div className="flex flex-col gap-3">
          <span className="text-label-caps text-foreground">权限矩阵</span>
          <PermissionMatrixTable
            value={matrix}
            onChange={(next) => setMatrices((prev) => ({ ...prev, [selected.id]: next }))}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setMatrices((prev) => ({
                  ...prev,
                  [selected.id]: cloneMatrix(selected.permissions),
                }))
              }
            >
              查看预设
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleDemo("演示模式，暂不支持复制到其他角色")}
            >
              复制到其他角色
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
