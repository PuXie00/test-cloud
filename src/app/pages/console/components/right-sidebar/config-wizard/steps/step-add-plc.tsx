import { Cpu, FileText, Loader2, Plus, ScanLine, SkipForward, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import type { PlcConnectionState } from "@/app/pages/console/hooks/plc-runtime-types";
import { useMasterScan } from "@/app/pages/console/hooks/use-master-scan";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { useSelection } from "@/app/pages/console/hooks/use-selection";
import { DeleteImpactDialog } from "../../delete-impact-dialog";
import { ProjectEditBoundary } from "../../project-edit-boundary";
import {
  computeDeleteImpact,
  deleteImpactRequiresConfirmation,
  type DeleteImpact,
} from "../../project-structure-tree-data";
import { PlcForm } from "../../property-forms/plc-form";
import { MotorAddDialog } from "../dialogs/motor-add-dialog";
import { PlcAddDialog } from "../dialogs/plc-add-dialog";
import { PlcScanDialog } from "../dialogs/plc-scan-dialog";
import { wizardBtnSecondary } from "../wizard-buttons";
import type { WizardView } from "../wizard-state";
import { WizardStepHeading } from "../wizard-step-heading";

const CONNECTION_STATUS: Record<PlcConnectionState, { label: string; dotClass: string }> = {
  disconnected: { label: "未连接", dotClass: "bg-muted-foreground" },
  connecting: { label: "连接中", dotClass: "bg-primary animate-pulse" },
  connected: { label: "已连接", dotClass: "bg-show" },
  abnormal: { label: "连接异常", dotClass: "bg-warning" },
};

type RouteCardProps = {
  icon: LucideIcon;
  title: string;
  detail: string;
  busy?: boolean;
  onClick: () => void;
};

const RouteCard = ({ icon: Icon, title, detail, busy = false, onClick }: RouteCardProps) => (
  <button
    type="button"
    aria-busy={busy}
    disabled={busy}
    onClick={onClick}
    className="flex min-w-0 flex-col items-start gap-1 rounded-md bg-muted p-3 text-left hover:bg-accent disabled:cursor-progress"
  >
    <span className="flex items-center gap-1.5 text-body-md font-medium text-foreground">
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      )}
      {title}
    </span>
    <span className="text-body-sm text-muted-foreground">{detail}</span>
  </button>
);

type StepAddPlcProps = {
  onNavigate: (view: WizardView) => void;
};

export const StepAddPlc = ({ onNavigate }: StepAddPlcProps) => {
  const { objects, plcs, motors, removePlc } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();
  const masterScan = useMasterScan();
  const { treeFocus, clearSelection, setTreeFocus } = useSelection();
  const [addOpen, setAddOpen] = useState(false);
  const [motorAddPlcId, setMotorAddPlcId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ plcId: number; impact: DeleteImpact } | null>(
    null,
  );
  const selectedId = treeFocus?.kind === "master" ? treeFocus.id : null;

  const selectPlc = (id: number) => {
    clearSelection();
    setTreeFocus({ kind: "master", id });
  };

  const removePlcNow = (id: number) => {
    const label = formatPlcDisplayName(plcs, id);
    removePlc(id);
    toast.warning(`已删除: ${label}`);
    if (selectedId === id) setTreeFocus(null);
  };

  const handleRemove = (id: number) => {
    const impact = computeDeleteImpact({ kind: "plc", plcId: id }, { objects, motors, plcs });
    if (impact && deleteImpactRequiresConfirmation(impact)) {
      setPendingDelete({ plcId: id, impact });
      return;
    }
    removePlcNow(id);
  };

  return (
    <div className="space-y-4">
      <WizardStepHeading
        title="现场设备准备到哪一步了？"
        description="主控是接入网络的控制器，驱动单元是它带的电机，接在 C、D 两个口上。"
      />

      <div className="grid grid-cols-3 gap-2">
        <RouteCard
          icon={ScanLine}
          title="已联网"
          detail="扫描网络，一次带回主控和电机"
          busy={masterScan.scanning}
          onClick={masterScan.startScan}
        />
        <RouteCard
          icon={FileText}
          title="还没到现场"
          detail="按图纸手动添加，到现场后再对账"
          onClick={() => setAddOpen(true)}
        />
        <RouteCard
          icon={SkipForward}
          title="暂时不配"
          detail="先做 3D 和动作，随时能回来"
          onClick={() => onNavigate("review")}
        />
      </div>

      {plcs.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-label-caps text-muted-foreground">已配置主控 ({plcs.length})</h3>
          <div className="space-y-1 rounded-md bg-muted p-2">
            {plcs.map((plc) => {
              const status = CONNECTION_STATUS[getPlcRuntime(plc.id).connection];
              const plcMotors = motors.filter((motor) => motor.plcId === plc.id);
              const portCount = (busNo: 0 | 1) =>
                plcMotors.filter((motor) => motor.busNo === busNo).length;
              const selected = selectedId === plc.id;
              return (
                <div
                  key={plc.id}
                  className={cn("rounded-md bg-input-background", selected && "ring-1 ring-primary")}
                >
                  <div className="flex items-center gap-2 pr-1">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectPlc(plc.id)}
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left [@media(pointer:coarse)]:min-h-11"
                    >
                      <Cpu className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-md text-foreground">
                          {formatPlcDisplayName(plcs, plc)}
                        </span>
                        <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                          {plc.ip}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground">
                        <span className={cn("h-2 w-2 rounded-full", status.dotClass)} aria-hidden />
                        {status.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${formatPlcDisplayName(plcs, plc)}`}
                      onClick={() => handleRemove(plc.id)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-destructive [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 pb-2">
                    <span className="font-mono text-mono-md tabular-nums text-muted-foreground">
                      C 口 {portCount(0)} 台 · D 口 {portCount(1)} 台
                    </span>
                    <button
                      type="button"
                      className={wizardBtnSecondary}
                      onClick={() => setMotorAddPlcId(plc.id)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      添加驱动单元
                    </button>
                  </div>
                  {selected ? (
                    <div className="rounded-b-md bg-muted">
                      <ProjectEditBoundary
                        key={plc.id}
                        ownerPrefix={`wizard:plc:${plc.id}`}
                        label="修改 PLC"
                      >
                        <PlcForm plcId={plc.id} />
                      </ProjectEditBoundary>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <PlcScanDialog
        open={masterScan.resultsOpen}
        onOpenChange={masterScan.setResultsOpen}
        results={masterScan.results}
      />
      <PlcAddDialog open={addOpen} onOpenChange={setAddOpen} />
      <MotorAddDialog
        open={motorAddPlcId !== null}
        onOpenChange={(open) => {
          if (!open) setMotorAddPlcId(null);
        }}
        mode="add"
        plcId={motorAddPlcId ?? 0}
      />
      <DeleteImpactDialog
        impact={pendingDelete?.impact ?? null}
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) removePlcNow(pendingDelete.plcId);
          setPendingDelete(null);
        }}
      />
    </div>
  );
};
