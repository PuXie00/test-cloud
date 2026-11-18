import { useCallback, useState } from "react";
import { toast } from "sonner";
import { filterNewMasters } from "./plc-online";
import { usePlcRuntime } from "./plc-runtime-provider";
import { useProjectStore } from "./use-project-store";

type UseMasterScanOptions = {
  /** 能改工程时扫到新主控才打开扫描弹窗；只读时只刷新在线状态 */
  canAdd?: boolean;
};

/** 点「扫描主控」：刷新在线状态；扫到工程里没有的主控就打开扫描弹窗 */
export const useMasterScan = ({ canAdd = true }: UseMasterScanOptions = {}) => {
  const { plcs } = useProjectStore();
  const { scan, scanAll } = usePlcRuntime();
  const [resultsOpen, setResultsOpen] = useState(false);

  const startScan = useCallback(() => {
    void (async () => {
      try {
        const masters = await scanAll();
        if (canAdd && filterNewMasters(masters, plcs).length > 0) {
          setResultsOpen(true);
          return;
        }
        toast.success(masters.length === 0 ? "未发现主控" : "未发现新主控");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "扫描失败");
      }
    })();
  }, [canAdd, plcs, scanAll]);

  return { scanning: scan.scanning, resultsOpen, setResultsOpen, startScan };
};
