import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { PlcScanResult } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { usePlcRuntime } from "./plc-runtime-provider";
import { useProjectStore } from "./use-project-store";

/** 扫描网络中的主控，只把工程里还没有的结果交给扫描弹窗 */
export const useMasterScan = () => {
  const { plcs } = useProjectStore();
  const { scanAll } = usePlcRuntime();
  const [scanning, setScanning] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [results, setResults] = useState<PlcScanResult[]>([]);

  const startScan = useCallback(() => {
    if (scanning) return;
    setScanning(true);
    void (async () => {
      try {
        const masters = await scanAll();
        const next = masters
          .filter((m) => !plcs.some((plc) => plc.ip === m.ip))
          .map((m) => ({ id: m.ip, ip: m.ip, plcModel: m.plcModel, axis: m.axis }));
        if (next.length === 0) {
          toast.success("未发现新主控");
          return;
        }
        setResults(next);
        setResultsOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "扫描失败");
      } finally {
        setScanning(false);
      }
    })();
  }, [plcs, scanAll, scanning]);

  return { scanning, results, resultsOpen, setResultsOpen, startScan };
};
