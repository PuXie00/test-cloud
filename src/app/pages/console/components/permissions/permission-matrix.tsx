import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/components/ui/utils";
import { PERMISSION_LEVELS, PERMISSION_MODULES } from "./permissions-constants";
import type { PermissionLevel, PermissionMatrix } from "./permissions-types";

type PermissionMatrixProps = {
  value: PermissionMatrix;
  onChange?: (matrix: PermissionMatrix) => void;
  readOnly?: boolean;
  className?: string;
};

export const PermissionMatrixTable = ({
  value,
  onChange,
  readOnly = false,
  className,
}: PermissionMatrixProps) => {
  const handleToggle = (
    moduleId: (typeof PERMISSION_MODULES)[number]["id"],
    level: PermissionLevel,
    checked: boolean,
  ) => {
    if (readOnly || !onChange) return;
    onChange({
      ...value,
      [moduleId]: { ...value[moduleId], [level]: checked },
    });
  };

  return (
    <div className={cn("overflow-x-auto rounded-md bg-muted/50 p-3", className)}>
      <table className="w-full min-w-[480px] border-collapse text-body-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">功能模块</th>
            {PERMISSION_LEVELS.map((level) => (
              <th key={level.id} className="px-2 pb-2 text-center font-medium">
                {level.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MODULES.map((mod, rowIndex) => (
            <tr
              key={mod.id}
              className={cn(rowIndex % 2 === 0 ? "bg-background/40" : "bg-card/40")}
            >
              <td className="py-2 pr-4 text-foreground">{mod.label}</td>
              {PERMISSION_LEVELS.map((level) => (
                <td key={level.id} className="px-2 py-2 text-center">
                  <Checkbox
                    checked={value[mod.id][level.id]}
                    disabled={readOnly}
                    onCheckedChange={(checked) =>
                      handleToggle(mod.id, level.id, checked === true)
                    }
                    aria-label={`${mod.label} ${level.label}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
