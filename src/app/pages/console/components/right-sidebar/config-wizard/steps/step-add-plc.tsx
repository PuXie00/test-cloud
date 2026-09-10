import { Cpu, Plus, ScanLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";
import { ProjectEditBoundary } from "../../project-edit-boundary";
import { PlcForm } from "../../property-forms/plc-form";
import { PlcAddDialog } from "../dialogs/plc-add-dialog";
import { PlcScanDialog } from "../dialogs/plc-scan-dialog";

const btnClass =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-input-background px-3 text-body-sm hover:bg-accent [@media(pointer:coarse)]:h-11";

export const StepAddPlc = () => {
  const { plcs, removePlc } = useProjectStore();
  const [scanOpen, setScanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(plcs[0]?.id ?? null);

  const handleRemove = (id: number) => {
    const label = formatPlcDisplayName(plcs, id);
    removePlc(id);
    toast.warning(`已删除: ${label}`);
    if (selectedId === id) {
      setSelectedId(plcs.find((plc) => plc.id !== id)?.id ?? null);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-heading-md text-foreground">主控与驱动单元</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnClass} onClick={() => setScanOpen(true)}>
          <ScanLine className="h-4 w-4" aria-hidden />
          扫描网络中的主控
        </button>
        <button type="button" className={btnClass} onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          手动添加主控
        </button>
      </div>

      <div>
        <p className="mb-2 text-label-caps text-muted-foreground">已配置主控 ({plcs.length})</p>
        <div className="space-y-1 rounded-md bg-muted p-2">
          {plcs.length === 0 ? (
            <p className="px-3 py-4 text-center text-body-sm text-muted-foreground">
              暂无主控，请扫描或手动添加
            </p>
          ) : (
            plcs.map((plc) => (
              <div
                key={plc.id}
                className={cn(
                  "flex items-center gap-2 rounded-md bg-input-background px-3 py-2",
                  selectedId === plc.id && "ring-1 ring-primary",
                )}
              >
                <Cpu className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedId(plc.id)}
                >
                  <span className="block text-body-sm text-foreground">
                    {formatPlcDisplayName(plcs, plc)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {plc.ip}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  onClick={() => handleRemove(plc.id)}
                  className="p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedId ? (
        <div className="rounded-md bg-muted">
          <ProjectEditBoundary
            key={selectedId}
            ownerPrefix={`wizard:plc:${selectedId}`}
            label="修改 PLC"
          >
            <PlcForm plcId={selectedId} />
          </ProjectEditBoundary>
        </div>
      ) : null}

      <p className="text-body-sm text-muted-foreground">无需真实设备可跳过，进入离线仿真</p>

      <PlcScanDialog open={scanOpen} onOpenChange={setScanOpen} results={[]} />
      <PlcAddDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
};
