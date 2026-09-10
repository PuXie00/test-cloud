import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { cn } from "@/app/components/ui/utils";
import { CollabField } from "../collab-field";
import { CollabSection } from "../collab-section";
import { CollabSectionPanel } from "../collab-section-panel";
import { CollabStatusPill } from "../collab-status-pill";
import {
  CONFLICT_STRATEGY_OPTIONS,
  OPERATOR_OPTIONS,
  SOURCE_HOST_OPTIONS,
} from "../collab-constants";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollaborationState, ObjectGroupAssignment } from "../collab-types";

type AssignmentsSectionProps = {
  assignments: ObjectGroupAssignment[];
  conflictStrategy: CollaborationState["conflictStrategy"];
  editingAssignments: boolean;
  onChange: (patch: Partial<CollaborationState>) => void;
};

const resolveAssignmentStatus = (
  operator: string | null,
  sourceHost: string | null,
): ObjectGroupAssignment["status"] => {
  if (!operator || operator === "—" || !sourceHost || sourceHost === "—") {
    return "idle";
  }
  return "active";
};

export const AssignmentsSection = ({
  assignments,
  conflictStrategy,
  editingAssignments,
  onChange,
}: AssignmentsSectionProps) => {
  const handleAssignmentChange = (
    groupId: string,
    field: "operator" | "sourceHost",
    value: string,
  ) => {
    const next = assignments.map((item) => {
      if (item.groupId !== groupId) return item;
      const operator = field === "operator" ? (value === "—" ? null : value) : item.operator;
      const sourceHost =
        field === "sourceHost" ? (value === "—" ? null : value) : item.sourceHost;
      return {
        ...item,
        operator,
        sourceHost,
        status: resolveAssignmentStatus(operator, sourceHost),
      };
    });
    onChange({ assignments: next });
  };

  return (
    <CollabSection
      title="区域分工"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onChange({ editingAssignments: !editingAssignments })}
        >
          {editingAssignments ? "完成编辑" : "编辑分工"}
        </Button>
      }
    >
      <CollabSectionPanel className="p-0">
        <Table>
          <TableHeader>
            <TableRow className={cn(COLLAB_SURFACES.elevated, "border-0 hover:bg-transparent")}>
              <TableHead className="h-9 text-label-caps text-muted-foreground">设备组</TableHead>
              <TableHead className="h-9 text-label-caps text-muted-foreground">操作员</TableHead>
              <TableHead className="h-9 text-label-caps text-muted-foreground">来源主机</TableHead>
              <TableHead className="h-9 text-label-caps text-muted-foreground">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((item, index) => (
              <TableRow
                key={item.groupId}
                className={cn(
                  index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
                  "border-0",
                )}
              >
                <TableCell className="py-2.5 text-body-md text-foreground">{item.groupName}</TableCell>
                <TableCell className="py-2.5">
                  {editingAssignments ? (
                    <Select
                      value={item.operator ?? "—"}
                      onValueChange={(value) =>
                        handleAssignmentChange(item.groupId, "operator", value)
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-full max-w-[7rem] bg-background"
                        aria-label="操作员"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATOR_OPTIONS.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-body-md text-foreground">{item.operator ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  {editingAssignments ? (
                    <Select
                      value={item.sourceHost ?? "—"}
                      onValueChange={(value) =>
                        handleAssignmentChange(item.groupId, "sourceHost", value)
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-full max-w-[7rem] bg-background"
                        aria-label="来源主机"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_HOST_OPTIONS.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-body-md text-foreground">{item.sourceHost ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  <CollabStatusPill variant={item.status === "active" ? "active" : "idle"}>
                    {item.status === "active" ? "控制中" : "空闲"}
                  </CollabStatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className={cn("border-t border-border/40 p-4", COLLAB_SURFACES.recessed)}>
          <CollabField label="冲突处理策略">
            <Select
              value={conflictStrategy}
              onValueChange={(value) =>
                onChange({ conflictStrategy: value as CollaborationState["conflictStrategy"] })
              }
            >
              <SelectTrigger className="w-full bg-background" aria-label="冲突处理策略">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFLICT_STRATEGY_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CollabField>
        </div>
      </CollabSectionPanel>
    </CollabSection>
  );
};
