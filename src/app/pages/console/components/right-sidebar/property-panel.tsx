import { Pencil, X } from "lucide-react";
import { PanelHeader } from "@/app/components/ics/panel-header";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import type { ControlledObjectId, MotorId } from "@/app/pages/console/hooks/selection-context";
import type { ProjectSelection } from "./project-data";
import { cn } from "@/app/components/ui/utils";
import { ControlledObjectForm } from "./property-forms/controlled-object-form";
import { MotorForm } from "./property-forms/motor-form";
import { MultiMotorDriveParamsForm } from "./property-forms/multi-motor-drive-params-form";
import { PlcForm } from "./property-forms/plc-form";
import { MultiSelectSummaryPanel } from "./multi-select-summary-panel";
import { ProjectEditBoundary } from "./project-edit-boundary";

type PropertySectionProps = {
  className?: string;
};

const PLACEHOLDER = "点击工程树中的节点，在此查看并修改参数配置。";

const getEditBoundary = (
  treeFocus: ProjectSelection,
  multiSelectedIds: ControlledObjectId[],
  multiSelectedMotorIds: MotorId[],
): { ownerPrefix: string; label: string } | null => {
  if (multiSelectedMotorIds.length > 1) {
    return {
      ownerPrefix: `property:motors:${multiSelectedMotorIds.join(",")}`,
      label: "修改电机",
    };
  }
  if (multiSelectedMotorIds.length === 1) {
    return {
      ownerPrefix: `property:motor:${multiSelectedMotorIds[0]}`,
      label: "修改电机",
    };
  }
  if (treeFocus?.kind === "master") {
    return {
      ownerPrefix: `property:plc:${treeFocus.id}`,
      label: "修改 PLC",
    };
  }
  if (treeFocus?.kind === "motor") {
    return {
      ownerPrefix: `property:motor:${treeFocus.id}`,
      label: "修改电机",
    };
  }
  if (multiSelectedIds.length > 1) {
    return {
      ownerPrefix: `property:objects:${multiSelectedIds.join(",")}`,
      label: "修改受控物体",
    };
  }
  if (multiSelectedIds.length === 1) {
    return {
      ownerPrefix: `property:object:${multiSelectedIds[0]}`,
      label: "修改受控物体",
    };
  }
  if (treeFocus?.kind === "controlled-object") {
    return {
      ownerPrefix: `property:object:${treeFocus.id}`,
      label: "修改受控物体",
    };
  }
  return null;
};

const getSelectionLabel = (
  treeFocus: ProjectSelection,
  multiSelectedIds: ControlledObjectId[],
  multiSelectedMotorIds: MotorId[],
  findObject: ReturnType<typeof useProjectStore>["findObject"],
  findPlc: ReturnType<typeof useProjectStore>["findPlc"],
  findMotor: ReturnType<typeof useProjectStore>["findMotor"],
  motors: ReturnType<typeof useProjectStore>["motors"],
  plcs: ReturnType<typeof useProjectStore>["plcs"],
): string | null => {
  if (multiSelectedMotorIds.length > 1) return `已选 ${multiSelectedMotorIds.length} 个电机`;
  if (multiSelectedMotorIds.length === 1) {
    const motor = findMotor(multiSelectedMotorIds[0]);
    return motor ? formatMotorDisplayName(motors, motor) : null;
  }
  if (treeFocus?.kind === "master") {
    const plc = findPlc(treeFocus.id);
    return plc ? formatPlcDisplayName(plcs, plc) : null;
  }
  if (treeFocus?.kind === "motor") {
    const motor = findMotor(treeFocus.id);
    return motor ? formatMotorDisplayName(motors, motor) : null;
  }
  if (multiSelectedIds.length > 1) return `已选 ${multiSelectedIds.length} 个受控物体`;
  if (multiSelectedIds.length === 1) return findObject(multiSelectedIds[0])?.name ?? null;
  if (treeFocus?.kind === "controlled-object") return findObject(treeFocus.id)?.name ?? null;
  return null;
};

const ControlledObjectEditor = ({ id }: { id: number }) => {
  const { findObject } = useProjectStore();
  const object = findObject(id);
  if (!object) return null;
  return <ControlledObjectForm objectId={id} />;
};

const MasterEditor = ({ id }: { id: number }) => {
  const { findPlc } = useProjectStore();
  const plc = findPlc(id);
  if (!plc) return null;
  return <PlcForm plcId={id} />;
};

const MotorEditor = ({ id }: { id: number }) => <MotorForm motorId={id} />;

const PropertyContent = () => {
  const { treeFocus, multiSelectedIds, multiSelectedMotorIds } = useSelection();

  if (multiSelectedMotorIds.length > 1) {
    return <MultiMotorDriveParamsForm motorIds={multiSelectedMotorIds} />;
  }
  if (multiSelectedMotorIds.length === 1) {
    return <MotorEditor id={multiSelectedMotorIds[0]!} />;
  }
  if (treeFocus?.kind === "master") return <MasterEditor id={treeFocus.id} />;
  if (treeFocus?.kind === "motor") return <MotorEditor id={treeFocus.id} />;
  if (multiSelectedIds.length > 1) {
    return <MultiSelectSummaryPanel objectIds={multiSelectedIds} />;
  }
  if (multiSelectedIds.length === 1) {
    return <ControlledObjectEditor id={multiSelectedIds[0]!} />;
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
        <Pencil className="h-4 w-4" aria-hidden />
      </div>
      <p className="text-body-sm text-muted-foreground">{PLACEHOLDER}</p>
    </div>
  );
};

export const PropertySection = ({ className }: PropertySectionProps) => {
  const { findObject, findPlc, findMotor, motors, plcs } = useProjectStore();
  const { treeFocus, multiSelectedIds, multiSelectedMotorIds, setTreeFocus, clearSelection } =
    useSelection();
  const selectionLabel = getSelectionLabel(
    treeFocus,
    multiSelectedIds,
    multiSelectedMotorIds,
    findObject,
    findPlc,
    findMotor,
    motors,
    plcs,
  );
  const hasContent =
    treeFocus?.kind === "master" ||
    treeFocus?.kind === "motor" ||
    multiSelectedIds.length > 0 ||
    multiSelectedMotorIds.length > 0;
  const editBoundary = getEditBoundary(
    treeFocus,
    multiSelectedIds,
    multiSelectedMotorIds,
  );

  const handleClose = () => {
    setTreeFocus(null);
    clearSelection();
  };

  return (
    <section
      className={cn(
        "flex h-full min-h-0 w-[320px] max-w-[320px] shrink-0 flex-col overflow-hidden bg-card-muted",
        className,
      )}
      aria-label={selectionLabel ? `属性 · ${selectionLabel}` : "属性"}
    >
      <PanelHeader
        title={selectionLabel ? `属性 · ${selectionLabel}` : "属性"}
        extra={
          hasContent ? (
            <button
              type="button"
              aria-label="关闭属性"
              onClick={handleClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null
        }
      />
      <div className="custom-scrollbar h-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
        {editBoundary ? (
          <ProjectEditBoundary
            key={editBoundary.ownerPrefix}
            ownerPrefix={editBoundary.ownerPrefix}
            label={editBoundary.label}
          >
            <PropertyContent />
          </ProjectEditBoundary>
        ) : (
          <PropertyContent />
        )}
      </div>
    </section>
  );
};
