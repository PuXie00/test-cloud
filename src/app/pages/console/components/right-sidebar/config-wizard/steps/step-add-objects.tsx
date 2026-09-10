import { Box, Cylinder, Circle, CircleDot, Hexagon, Square, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { CONTROL_TYPE_DEFINITIONS, PALETTE_SHAPE_DEFINITIONS } from "@/app/pages/console/components/right-sidebar/config-wizard/config-descriptors";
import { ControlledObjectForm } from "@/app/pages/console/components/right-sidebar/property-forms/controlled-object-form";
import { DeleteImpactDialog } from "@/app/pages/console/components/right-sidebar/delete-impact-dialog";
import { ProjectEditBoundary } from "@/app/pages/console/components/right-sidebar/project-edit-boundary";
import { useObjectDeletion } from "@/app/pages/console/hooks/use-object-deletion";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { ShapePresetId } from "@/app/project/configuration-types";

const SHAPE_ICONS: Record<Exclude<ShapePresetId, "external">, typeof Box> = {
  cube: Box,
  cyl: Cylinder,
  sphere: Circle,
  ring: CircleDot,
  sqRing: Square,
  prism6: Hexagon,
};

export const StepAddObjects = () => {
  const { objects, addObjectFromShape } = useProjectStore();
  const objectDeletion = useObjectDeletion();
  const [selectedId, setSelectedId] = useState<number | null>(objects[0]?.id ?? null);

  const handleAddShape = (id: ShapePresetId) => {
    const object = addObjectFromShape(id);
    if (!object) return;
    setSelectedId(object.id);
    toast.success(`已添加: ${object.name}`);
  };

  const handleRequestRemove = (id: number) => {
    objectDeletion.requestDelete([id]);
  };

  const handleConfirmRemove = useCallback((): boolean => {
    const pendingIds = objectDeletion.impact?.objectIds ?? [];
    const pendingName = objectDeletion.impact?.objectNames[0];
    const outcome = objectDeletion.confirmDelete();
    if (outcome !== "deleted" && outcome !== "no-op") return false;

    const removed = new Set(pendingIds);
    if (selectedId && removed.has(selectedId)) {
      setSelectedId(
        objects.find((object) => object.id !== selectedId && !removed.has(object.id))
          ?.id ?? null,
      );
    }
    if (outcome === "deleted" && pendingName && pendingIds.length === 1) {
      toast.warning(`已删除: ${pendingName}`);
    } else if (outcome === "deleted" && pendingIds.length > 1) {
      toast.warning(`已删除 ${pendingIds.length} 个受控物体`);
    }
    return true;
  }, [objectDeletion, objects, selectedId]);

  return (
    <div className="space-y-5">
      <p className="text-heading-md text-foreground">添加受控物体并配置参数</p>

      <div className="grid grid-cols-3 gap-3">
        {PALETTE_SHAPE_DEFINITIONS.map((preset) => {
          const Icon = SHAPE_ICONS[preset.id as Exclude<ShapePresetId, "external">];
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleAddShape(preset.id)}
              className="flex min-h-[80px] flex-col items-center justify-center gap-2 rounded-md bg-input-background p-3 transition-all hover:-translate-y-0.5 hover:bg-accent [@media(pointer:coarse)]:min-h-[88px]"
            >
              <Icon className="h-6 w-6 text-primary" aria-hidden />
              <span className="text-body-sm font-medium">{preset.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {CONTROL_TYPE_DEFINITIONS.map((definition) => (
          <div
            key={definition.id}
            className="rounded-md bg-muted px-3 py-2 text-body-sm text-muted-foreground"
          >
            {definition.label} · 至少 {definition.minimumDriveAxes} 轴
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-label-caps text-muted-foreground">
          已添加的受控物体 ({objects.length})
        </p>
        {objects.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">
            尚未添加受控物体，请点击上方模型类型添加
          </p>
        ) : (
          <div className="space-y-1 rounded-md bg-muted p-2">
            {objects.map((object) => {
              const shape = PALETTE_SHAPE_DEFINITIONS.find(
                (preset) => preset.id === object.shapePreset,
              );
              const selected = selectedId === object.id;
              return (
                <div
                  key={object.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md bg-input-background px-3 py-2",
                    selected && "ring-1 ring-primary",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedId(object.id)}
                  >
                    <span className="block truncate text-body-sm text-foreground">{object.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {shape?.label ?? object.shapePreset}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${object.name}`}
                    onClick={() => handleRequestRemove(object.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedId ? (
        <div className="rounded-md bg-muted">
          <ProjectEditBoundary
            key={selectedId}
            ownerPrefix={`wizard:object:${selectedId}`}
            label="修改受控物体"
          >
            <ControlledObjectForm objectId={selectedId} />
          </ProjectEditBoundary>
        </div>
      ) : null}

      <DeleteImpactDialog
        objectImpact={objectDeletion.impact}
        open={objectDeletion.open}
        onOpenChange={(open) => {
          if (!open) objectDeletion.cancelDelete();
        }}
        onConfirm={handleConfirmRemove}
        error={objectDeletion.lastError}
      />
    </div>
  );
};
