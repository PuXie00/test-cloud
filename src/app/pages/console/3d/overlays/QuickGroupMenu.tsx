import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import { useProject } from "@/app/project/use-project";
import type { SceneGroupConfig } from "@/app/project/project-document-types";
import { useSelection } from "../../hooks/use-selection";
import { useViz3DContext } from "../Viz3DProvider";
import { resolveMonitorObjectIds } from "../viz3d-selection-sync";

export const QuickGroupMenu = ({ canEdit }: { canEdit: boolean }) => {
  const { currentProject, runTrackedDocumentUpdate } = useProject();
  const { selectedId, multiSelectedIds, replaceSelection, setTreeFocus } = useSelection();
  const engine = useViz3DContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const setup = currentProject?.document?.setup;
  if (!setup) return null;

  const groups = setup.scene?.groups ?? [];
  const knownIds = new Set(setup.controlledObjects.map((object) => object.id));
  const selected = resolveMonitorObjectIds(selectedId, multiSelectedIds).filter(id => knownIds.has(id));
  const updateGroups = (label: string, change: (groups: SceneGroupConfig[]) => SceneGroupConfig[]) => {
    const result = runTrackedDocumentUpdate(label, doc => ({
      ...doc,
      setup: {
        ...doc.setup,
        scene: { ...doc.setup.scene, groups: change(doc.setup.scene?.groups ?? []) },
      },
    }));
    if (!result.ok) toast.error(result.reason);
    return result.ok;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="h-7 rounded-sm px-2 text-body-sm hover:bg-accent">快捷分组</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[200] w-52 max-w-[var(--radix-popover-content-available-width)] space-y-2 p-2" aria-label="快捷分组"
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {canEdit && (
          <form className="flex gap-1" onSubmit={event => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed || !selected.length) return;
            if (groups.some(group => group.name === trimmed)) {
              toast.error("分组名称已存在");
              return;
            }
            const group = { id: crypto.randomUUID(), name: trimmed, objectIds: selected };
            if (updateGroups("新建快捷分组", current => [...current, group])) setName("");
          }}>
            <input aria-label="分组名称" placeholder="分组名称" value={name}
              onChange={event => setName(event.target.value)}
              className="min-w-0 flex-1 rounded border bg-background px-2 text-body-sm" />
            <button disabled={!name.trim() || !selected.length} className="shrink-0 whitespace-nowrap rounded bg-primary px-2 py-1 text-body-sm text-primary-foreground disabled:opacity-40">
              保存（{selected.length}）
            </button>
          </form>
        )}
        {!groups.length && <p className="px-1 text-body-sm text-muted-foreground">暂无分组</p>}
        <div className="max-h-64 overflow-y-auto">
          {groups.map(group => (
            <div key={group.id} className="flex items-center">
              <button type="button" disabled={!group.objectIds.length} title={group.name}
                className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-body-sm hover:bg-accent disabled:opacity-40"
                onClick={() => {
                  engine.clearMotorSelection();
                  setTreeFocus(null);
                  replaceSelection(group.objectIds);
                  setOpen(false);
                }}>
                {group.name}（{group.objectIds.length}）
              </button>
              {canEdit && <button type="button" aria-label={`删除分组 ${group.name}`}
                className="rounded p-1 hover:bg-accent"
                onClick={() => updateGroups("删除快捷分组", current => current.filter(item => item.id !== group.id))}>
                <X className="size-4" />
              </button>}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
