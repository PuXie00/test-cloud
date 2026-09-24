import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Checkbox } from "@/app/components/ui/checkbox";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { PlcScanResult } from "../config-wizard-types";

type PlcScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: PlcScanResult[];
};

export const PlcScanDialog = ({ open, onOpenChange, results }: PlcScanDialogProps) => {
  const { addPlcsFromScan } = useProjectStore();
  const [selectedMasters, setSelectedMasters] = useState<Set<string>>(new Set());
  const [selectedAxes, setSelectedAxes] = useState<Set<string>>(new Set());

  const axisKey = (ip: string, slaveNo: number) => `${ip}:${slaveNo}`;

  const toggleMaster = (id: string) => {
    const hasSelectedAxis = [...selectedAxes].some((key) => key.startsWith(`${id}:`));
    if (selectedMasters.has(id) && hasSelectedAxis) return;
    setSelectedMasters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAxis = (masterId: string, key: string) => {
    const isAdding = !selectedAxes.has(key);
    setSelectedAxes((current) => {
      const next = new Set(current);
      if (isAdding) next.add(key);
      else next.delete(key);
      return next;
    });
    if (isAdding) {
      setSelectedMasters((current) => {
        if (current.has(masterId)) return current;
        const next = new Set(current);
        next.add(masterId);
        return next;
      });
    }
  };

  const pickedResults = useMemo(
    () =>
      results.flatMap((r) => {
        if (!selectedMasters.has(r.id)) return [];
        return [
          {
            ...r,
            axis: r.axis.filter((a) => selectedAxes.has(axisKey(r.ip, a.slaveNo))),
          },
        ];
      }),
    [results, selectedMasters, selectedAxes],
  );

  const hasSelection = pickedResults.length > 0;

  const handleAdd = async () => {
    const picked = pickedResults;
    if (picked.length === 0) return;
    await addPlcsFromScan(picked);
    toast.success(`已添加 ${picked.length} 个主控`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed top-[50%] left-[50%] z-50 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)] outline-none">
          <div className="flex h-12 items-center justify-between bg-muted px-4">
            <DialogTitle className="text-heading-md font-semibold">扫描结果</DialogTitle>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 bg-background p-4">
            {results.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-muted-foreground">未发现新主控</p>
            ) : (
              results.map((r) => (
                <div key={r.id} className="rounded-md bg-input-background px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-3 [@media(pointer:coarse)]:min-h-10">
                    <Checkbox
                      checked={selectedMasters.has(r.id)}
                      onCheckedChange={() => toggleMaster(r.id)}
                      aria-label={`选择 ${r.ip}`}
                    />
                    <span className="font-mono text-body-sm tabular-nums">{r.ip}</span>
                    <span className="text-body-sm text-muted-foreground">plcModel {r.plcModel}</span>
                  </label>
                  {r.axis.map((a) => (
                    <label
                      key={axisKey(r.ip, a.slaveNo)}
                      className="ml-8 flex cursor-pointer items-center gap-3 py-1 [@media(pointer:coarse)]:min-h-10"
                    >
                      <Checkbox
                        checked={selectedAxes.has(axisKey(r.ip, a.slaveNo))}
                        onCheckedChange={() => toggleAxis(r.id, axisKey(r.ip, a.slaveNo))}
                        aria-label={`选择从站 ${a.slaveNo}`}
                      />
                      <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                        从站#{a.slaveNo} · {a.busNo === 0 ? "C口" : "D口"}
                      </span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end gap-2 bg-muted px-4 py-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border px-3 py-2 text-body-sm"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={handleAdd}
              className="rounded-md bg-primary px-4 py-2 text-body-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              添加选中
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
