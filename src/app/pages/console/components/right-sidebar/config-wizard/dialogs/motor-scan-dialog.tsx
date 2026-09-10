import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Checkbox } from "@/app/components/ui/checkbox";
import { cn } from "@/app/components/ui/utils";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import type { MotorScanResult } from "../config-wizard-types";

type MotorScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plcId: number;
};

export const MotorScanDialog = ({ open, onOpenChange, plcId }: MotorScanDialogProps) => {
  const { addMotorsFromScan } = useProjectStore();
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<MotorScanResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && plcId) {
      setScanning(false);
      setSelected(new Set());
      setResults([]);
    }
    onOpenChange(isOpen);
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const picked = results.filter((r) => selected.has(r.id));
    if (!picked.length) return;
    const added = addMotorsFromScan(picked);
    toast.success(`已添加 ${added.length} 台驱动单元`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-[50%] left-[50%] z-50 w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)] outline-none",
          )}
        >
          <div className="flex h-12 items-center justify-between bg-muted px-4">
            <DialogTitle className="text-heading-md font-semibold">扫描驱动单元</DialogTitle>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3 bg-background p-4">
            {scanning ? (
              <p className="py-8 text-center text-body-sm text-muted-foreground">扫描中…</p>
            ) : results.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-muted-foreground">未发现驱动单元</p>
            ) : (
              results.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md bg-input-background px-3 py-2 [@media(pointer:coarse)]:min-h-10"
                >
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                    aria-label={`选择 ${r.nodeAddress}`}
                  />
                  <span className="font-mono text-body-sm">{r.nodeAddress}</span>
                  <span className="text-body-sm text-muted-foreground">{r.productModel}</span>
                </label>
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
              disabled={scanning || selected.size === 0}
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
