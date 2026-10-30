import { Crosshair, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { useViz3DContext } from "@/app/pages/console/3d/Viz3DProvider";
import { DeleteImpactDialog } from "@/app/pages/console/components/right-sidebar/delete-impact-dialog";
import { ProjectEditBoundary } from "@/app/pages/console/components/right-sidebar/project-edit-boundary";
import { useConsoleNav } from "@/app/pages/console/hooks/use-console-nav";
import { useObjectDeletion } from "@/app/pages/console/hooks/use-object-deletion";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import {
  CONTROL_TYPE_DEFINITION_BY_ID,
  defaultShapeDimensions,
  toEngineDimensions,
} from "../config-descriptors";
import type { ControlledObject } from "../config-wizard-types";
import { wizardBtnSecondary } from "../wizard-buttons";
import type { WizardMotionOption } from "../wizard-motion-options";
import { WizardMotionPicker } from "../wizard-motion-picker";
import { WizardObjectFields } from "../wizard-object-fields";
import { nextObjectPlacementX } from "../wizard-state";
import { WizardStepHeading } from "../wizard-step-heading";

const NEW_OBJECT_SHAPE = "cube";

const iconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11";

type ObjectCardProps = {
  object: ControlledObject;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
};

const ObjectCard = ({ object, selected, onSelect, onRemove }: ObjectCardProps) => {
  const engine = useViz3DContext();
  const cardRef = useRef<HTMLDivElement>(null);

  // 在 3D 里点选或拖入物体时，把对应的卡片滚到眼前
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  return (
    <div
      ref={cardRef}
      className={cn("rounded-md bg-input-background", selected && "ring-1 ring-primary")}
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="flex min-h-10 min-w-0 flex-1 flex-col justify-center px-3 py-1.5 text-left [@media(pointer:coarse)]:min-h-11"
        >
          <span className="truncate text-body-md text-foreground">{object.name}</span>
          <span className="truncate text-body-sm text-muted-foreground">
            {CONTROL_TYPE_DEFINITION_BY_ID[object.controlType].label}
          </span>
        </button>
        {selected ? (
          <button
            type="button"
            aria-label={`在 3D 中定位 ${object.name}`}
            onClick={() => engine.focusSelection()}
            className={cn(iconBtn, "hover:text-foreground")}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`删除 ${object.name}`}
          onClick={onRemove}
          className={cn(iconBtn, "hover:text-destructive")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {selected ? (
        <div className="px-3 pb-3 pt-1">
          <ProjectEditBoundary
            key={object.id}
            ownerPrefix={`wizard:object:${object.id}`}
            label="修改受控物体"
          >
            <WizardObjectFields object={object} />
          </ProjectEditBoundary>
        </div>
      ) : null}
    </div>
  );
};

export const StepAddObjects = () => {
  const { objects, addObjectFromShape } = useProjectStore();
  const { navigate } = useConsoleNav();
  const objectDeletion = useObjectDeletion();
  const { multiSelectedIds, treeFocus, select, replaceSelection, clearSelection, setTreeFocus } =
    useSelection();
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedId = multiSelectedIds.length === 1 ? multiSelectedIds[0] : null;
  const showPicker = objects.length === 0 || pickerOpen;

  const selectObject = (id: number) => {
    select(id);
    setTreeFocus({ kind: "controlled-object", id });
  };

  const handleAdd = (option: WizardMotionOption) => {
    const { w } = toEngineDimensions(NEW_OBJECT_SHAPE, defaultShapeDimensions(NEW_OBJECT_SHAPE));
    const object = addObjectFromShape(
      NEW_OBJECT_SHAPE,
      { x: nextObjectPlacementX(objects, w) },
      { controlType: option.controlType, namePrefix: option.title },
    );
    if (!object) return;
    selectObject(object.id);
    setPickerOpen(false);
  };

  const handleConfirmRemove = useCallback((): boolean => {
    const pendingIds = objectDeletion.impact?.objectIds ?? [];
    const pendingName = objectDeletion.impact?.objectNames[0];
    const outcome = objectDeletion.confirmDelete();
    if (outcome !== "deleted" && outcome !== "no-op") return false;

    const removed = new Set(pendingIds);
    const remaining = multiSelectedIds.filter((id) => !removed.has(id));
    if (remaining.length === 0) clearSelection();
    else if (remaining.length !== multiSelectedIds.length) replaceSelection(remaining);
    if (treeFocus?.kind === "controlled-object" && removed.has(treeFocus.id)) setTreeFocus(null);

    if (outcome === "deleted" && pendingName && pendingIds.length === 1) {
      toast.warning(`已删除: ${pendingName}`);
    } else if (outcome === "deleted" && pendingIds.length > 1) {
      toast.warning(`已删除 ${pendingIds.length} 个受控物体`);
    }
    return true;
  }, [clearSelection, multiSelectedIds, objectDeletion, replaceSelection, setTreeFocus, treeFocus]);

  return (
    <div className="space-y-4">
      <WizardStepHeading
        title="你想让什么动起来？"
        description="先选运动方式，它决定需要几个吊点。形状只影响 3D 外观，可以之后再改。"
      />

      {showPicker ? <WizardMotionPicker onPick={handleAdd} /> : null}

      {objects.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-label-caps text-muted-foreground">已添加 ({objects.length})</h3>
            <button
              type="button"
              aria-expanded={showPicker}
              className={wizardBtnSecondary}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {pickerOpen ? "收起" : "添加物体"}
            </button>
          </div>
          <div className="space-y-1 rounded-md bg-muted p-2">
            {objects.map((object) => (
              <ObjectCard
                key={object.id}
                object={object}
                selected={selectedId === object.id}
                onSelect={() => selectObject(object.id)}
                onRemove={() => objectDeletion.requestDelete([object.id])}
              />
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-body-sm text-muted-foreground">
        也可以从 3D 视口右侧把形状拖进来。速度、加减速和坐标在「工程结构 → 属性」，
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline"
          onClick={() => navigate("devices", { devicesTab: "structure" })}
        >
          现在打开
        </button>
        。
      </p>

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
