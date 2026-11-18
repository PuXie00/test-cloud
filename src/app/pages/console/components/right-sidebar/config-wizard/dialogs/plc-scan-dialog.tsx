import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/app/components/ui/dialog";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  formatRealAxisModel,
  formatRealAxisPosition,
  formatScannedPlcModel,
  normalizeIp,
  filterNewMasters,
  toRealAxes,
  toScannedAxes,
  type RealAxis,
} from "@/app/pages/console/hooks/plc-online";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";

type PlcScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const axisKey = (axis: Pick<RealAxis, "busNo" | "index">) => `${axis.busNo}:${axis.index}`;

const toggleIn = <K,>(set: ReadonlySet<K>, key: K): Set<K> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/** 扫描到的新主控（工程里已有的不列）；勾主控连同勾上的电机一起加入工程 */
export const PlcScanDialog = ({ open, onOpenChange }: PlcScanDialogProps) => {
  const { plcs, addPlcsFromScan } = useProjectStore();
  const { scan, scanAll, scanInBackground } = usePlcRuntime();
  const newMasters = useMemo(
    () => filterNewMasters(scan.masters ?? [], plcs),
    [scan.masters, plcs],
  );
  const axesByIp = useMemo(
    () => new Map(newMasters.map((master) => [master.ip, toRealAxes(master.axis ?? [])])),
    [newMasters],
  );

  // 默认全选；不想控的电机可以取消
  const [pickedMasters, setPickedMasters] = useState<Set<string>>(new Set());
  const [pickedAxes, setPickedAxes] = useState<Map<string, Set<string>>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const ipsKey = newMasters.map((master) => master.ip).join(",");
  useEffect(() => {
    if (!open) return;
    setPickedMasters(new Set(newMasters.map((master) => master.ip)));
    setPickedAxes(
      new Map(
        newMasters.map((master) => [
          master.ip,
          new Set((axesByIp.get(master.ip) ?? []).map(axisKey)),
        ]),
      ),
    );
    setExpanded(new Set());
  }, [open, scan.at, ipsKey]); // 打开时、或重新扫描换了一批结果时重置（列表从 ipsKey 读）

  const allAxisKeys = (ip: string) => new Set((axesByIp.get(ip) ?? []).map(axisKey));

  const toggleMaster = (ip: string) => {
    const picking = !pickedMasters.has(ip);
    setPickedMasters((current) => toggleIn(current, ip));
    setPickedAxes((current) => new Map(current).set(ip, picking ? allAxisKeys(ip) : new Set()));
  };

  /** 主控下的电机全选 / 全不选（全不选时主控本身仍然添加） */
  const toggleAllAxes = (ip: string) => {
    const all = allAxisKeys(ip);
    const allPicked = [...all].every((key) => pickedAxes.get(ip)?.has(key));
    setPickedAxes((current) => new Map(current).set(ip, allPicked ? new Set() : all));
    if (!allPicked) {
      setPickedMasters((masters) => (masters.has(ip) ? masters : new Set(masters).add(ip)));
    }
  };

  /**
   * 电机按口内顺序对应实轴（C-1 就是 C 口第 1 根），中间不能空：
   * 勾一根会把同口前面的一起勾上，取消一根会把同口后面的一起取消。
   */
  const toggleAxis = (ip: string, axis: RealAxis) => {
    const sameBus = (axesByIp.get(ip) ?? []).filter((item) => item.busNo === axis.busNo);
    const current = pickedAxes.get(ip) ?? new Set<string>();
    const next = new Set(current);
    if (current.has(axisKey(axis))) {
      for (const item of sameBus) if (item.index >= axis.index) next.delete(axisKey(item));
    } else {
      for (const item of sameBus) if (item.index <= axis.index) next.add(axisKey(item));
      setPickedMasters((masters) => (masters.has(ip) ? masters : new Set(masters).add(ip)));
    }
    setPickedAxes((map) => new Map(map).set(ip, next));
  };

  const picked = newMasters.filter((master) => pickedMasters.has(master.ip));
  const pickedAxesOf = (ip: string) =>
    (axesByIp.get(ip) ?? []).filter((axis) => pickedAxes.get(ip)?.has(axisKey(axis)));
  const canApply = picked.length > 0 && !adding && !scan.scanning;

  const handleRescan = () => {
    void scanAll().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "扫描失败");
    });
  };

  const handleApply = async () => {
    if (!canApply) return;
    setAdding(true);
    try {
      const added = await addPlcsFromScan(
        picked.map((master) => ({
          id: master.ip,
          ip: normalizeIp(master.ip),
          plcModel: master.plcModel,
          axis: toScannedAxes(pickedAxesOf(master.ip)),
        })),
      );
      if (added.length > 0) toast.success(`已添加 ${added.length} 台主控`);
      onOpenChange(false);
      // 每次新增主控后重新扫描一次
      if (added.length > 0) scanInBackground();
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-guide="console-master-scan-dialog"
          aria-describedby={undefined}
          className="fixed top-[50%] left-[50%] z-50 flex max-h-[min(640px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)] outline-none"
        >
          <div className="flex h-12 shrink-0 items-center justify-between bg-muted px-4">
            <DialogTitle className="text-heading-md font-semibold">扫描主控</DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="关闭"
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-accent pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-auto overflow-y-auto bg-background p-4">
            {newMasters.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-muted-foreground">未发现新主控</p>
            ) : (
              <ul className="space-y-1 rounded-md bg-muted p-2">
                {newMasters.map((master) => {
                  const axes = axesByIp.get(master.ip) ?? [];
                  const pickedCount = pickedAxesOf(master.ip).length;
                  const isOpen = expanded.has(master.ip);
                  const modelLabel = formatScannedPlcModel(master.plcModel);
                  const unknownModel = modelLabel.startsWith("未知型号");
                  return (
                    <li key={master.ip} className="rounded-md bg-input-background">
                      <div className="flex items-center gap-1 pl-3 pr-1">
                        <Checkbox
                          checked={pickedMasters.has(master.ip)}
                          onCheckedChange={() => toggleMaster(master.ip)}
                          aria-label={`添加 ${master.ip}`}
                        />
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "收起" : "展开"} ${master.ip}`}
                          onClick={() => setExpanded((current) => toggleIn(current, master.ip))}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-sm py-1 pr-2 text-left hover:bg-accent pointer-coarse:min-h-11"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                          <span className="shrink-0 font-mono text-body-sm tabular-nums text-foreground">
                            {master.ip}
                          </span>
                          <span
                            className={`min-w-0 flex-1 truncate text-body-sm ${
                              unknownModel ? "text-warning" : "text-muted-foreground"
                            }`}
                          >
                            {modelLabel}
                          </span>
                          <span className="shrink-0 font-mono text-mono-sm tabular-nums text-muted-foreground">
                            {pickedCount}/{axes.length}
                          </span>
                        </button>
                      </div>
                      {isOpen && axes.length > 0 ? (
                        <ul className="pb-1 pl-9 pr-3" aria-label={`${master.ip} 电机`}>
                          <li>
                            <label className="flex min-h-8 cursor-pointer items-center gap-3 rounded-sm px-2 text-body-sm text-muted-foreground hover:bg-accent pointer-coarse:min-h-11">
                              <Checkbox
                                checked={pickedCount === axes.length}
                                onCheckedChange={() => toggleAllAxes(master.ip)}
                                aria-label={`${master.ip} 全选电机`}
                              />
                              全选
                            </label>
                          </li>
                          {axes.map((axis) => {
                            const position = formatRealAxisPosition(axis);
                            return (
                              <li key={axisKey(axis)}>
                                <label className="flex min-h-8 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-accent pointer-coarse:min-h-11">
                                  <Checkbox
                                    checked={pickedAxes.get(master.ip)?.has(axisKey(axis)) ?? false}
                                    onCheckedChange={() => toggleAxis(master.ip, axis)}
                                    aria-label={`${master.ip} ${position}`}
                                  />
                                  <span className="w-9 shrink-0 font-mono text-mono-sm tabular-nums text-foreground">
                                    {position}
                                  </span>
                                  <span
                                    className={`min-w-0 flex-1 truncate text-body-sm ${
                                      axis.productModel ? "text-muted-foreground" : "text-warning"
                                    }`}
                                  >
                                    {formatRealAxisModel(axis)}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 bg-muted px-4 py-3">
            <button
              type="button"
              onClick={handleRescan}
              disabled={scan.scanning || adding}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-body-sm hover:bg-accent disabled:opacity-40 pointer-coarse:min-h-11"
            >
              {scan.scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              重新扫描
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="min-h-9 rounded-md border border-border px-3 text-body-sm hover:bg-accent pointer-coarse:min-h-11"
            >
              取消
            </button>
            <button
              data-guide="console-master-scan-apply"
              type="button"
              disabled={!canApply}
              onClick={() => void handleApply()}
              className="min-h-9 rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground disabled:opacity-40 pointer-coarse:min-h-11"
            >
              添加
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
