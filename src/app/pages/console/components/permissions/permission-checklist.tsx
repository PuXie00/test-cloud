import {
  PERMISSION_GROUPS,
  normalizePermissions,
  togglePermission,
  type PermissionId,
} from "@shared/auth/permissions";
import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/components/ui/utils";

type PermissionChecklistProps = {
  value: readonly PermissionId[];
  onChange?: (next: PermissionId[]) => void;
  readOnly?: boolean;
  className?: string;
};

/** 按板块分组的权限勾选；板块标题可整组勾选 / 取消 */
export const PermissionChecklist = ({ value, onChange, readOnly = false, className }: PermissionChecklistProps) => {
  const granted = new Set(value);
  const disabled = readOnly || !onChange;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {PERMISSION_GROUPS.map((group) => {
        const ids = group.points.map((point) => point.id);
        const checkedCount = ids.filter((id) => granted.has(id)).length;
        const groupState =
          checkedCount === 0 ? false : checkedCount === ids.length ? true : ("indeterminate" as const);
        return (
          <section key={group.id} className="rounded-md bg-muted/30 p-3">
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                checked={groupState}
                disabled={disabled}
                aria-label={`${group.label} 全选`}
                onCheckedChange={(checked) => {
                  const rest = value.filter((id) => !ids.includes(id));
                  onChange?.(normalizePermissions(checked === true ? [...rest, ...ids] : rest));
                }}
              />
              <span className="text-label-caps text-foreground">{group.label}</span>
            </div>
            <ul className="flex flex-col gap-1 pl-6">
              {group.points.map((point) => (
                <li key={point.id} className="flex items-start gap-2 py-1">
                  <Checkbox
                    id={`perm-${point.id}`}
                    className="mt-0.5"
                    checked={granted.has(point.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange?.(togglePermission(value, point.id, checked === true))}
                  />
                  <label htmlFor={`perm-${point.id}`} className="min-w-0 cursor-pointer">
                    <span className="block text-body-md text-foreground">{point.label}</span>
                    <span className="block text-body-sm text-muted-foreground">{point.description}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
