import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { isCppAckFailed, isCppAckOk } from "@shared/csocket/ack";
import type { PlcMasterStatus } from "@shared/csocket/plc-master-status";
import {
  composePlcRuntime,
  replaceMasterStatusMap,
  shouldApplyMasterStatusSnapshot,
} from "./plc-master-runtime";
import { type PlcRuntimeState, type ScannedMaster } from "./plc-runtime-types";
import { useProject } from "@/app/project/use-project";
import { aggregateSystemStatus, type AggregatedSystemStatus } from "./system-status-aggregate";
import { useProjectStore } from "./use-project-store";
import {
  getLastOpenProjectAck,
  ingestProjectVerifyFrame,
  isFailedOpenProjectVerifyAck,
  pruneProjectVerifyMap,
  shouldShowProjectMismatchDialog,
  subscribeLastOpenProjectAck,
  toOpenProjectCppAck,
  type PlcVerifyRecord,
} from "./project-verify";

type PlcRuntimeContextValue = {
  getPlcRuntime: (plcId: number) => PlcRuntimeState;
  /** 当前工程主控对应的 runtime 列表（顺序与 plcs 一致） */
  runtimes: PlcRuntimeState[];
  systemStatus: AggregatedSystemStatus;
  scannedMasters: ScannedMaster[];
  scanAll: () => Promise<ScannedMaster[]>;
  setSimulation: (plcId: number, enabled: boolean) => Promise<void>;
  setSimulationAll: (enabled: boolean) => Promise<void>;
  allStopAll: () => Promise<void>;
  simulationSwitchPending: boolean;
  shouldShowMismatchDialog: boolean;
  markMismatchDialogConsumed: () => void;
};

const PlcRuntimeContext = createContext<PlcRuntimeContextValue | null>(null);

export const PlcRuntimeProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject } = useProject();
  const projectId = currentProject?.id;
  const { plcs } = useProjectStore();
  const plcsRef = useRef(plcs);
  plcsRef.current = plcs;
  const [scannedMasters, setScannedMasters] = useState<ScannedMaster[]>([]);
  const [masterById, setMasterById] = useState<Map<number, PlcMasterStatus>>(
    () => new Map(),
  );
  const [simulationSwitchPending, setSimulationSwitchPending] = useState(false);
  const [verifyByPlcId, setVerifyByPlcId] = useState<Map<number, PlcVerifyRecord>>(
    () => new Map(),
  );
  const [mismatchDialogConsumed, setMismatchDialogConsumed] = useState(false);
  const lastOpenAck = useSyncExternalStore(
    subscribeLastOpenProjectAck,
    getLastOpenProjectAck,
    getLastOpenProjectAck,
  );
  const appliedOpenAckRef = useRef<unknown>(undefined);

  useEffect(() => {
    const known = new Set(plcs.map((plc) => plc.id));
    const ackChanged = appliedOpenAckRef.current !== lastOpenAck;
    if (ackChanged) {
      appliedOpenAckRef.current = lastOpenAck;
      setMismatchDialogConsumed(false);
    }
    const failedOpen = isFailedOpenProjectVerifyAck(lastOpenAck);
    if (failedOpen) {
      const ack = toOpenProjectCppAck(lastOpenAck);
      setVerifyByPlcId((prev) => ingestProjectVerifyFrame(prev, ack?.data, known));
    } else {
      setVerifyByPlcId((prev) => pruneProjectVerifyMap(prev, known));
    }
  }, [plcs, lastOpenAck]);

  useEffect(() => {
    setMasterById(new Map());
    setScannedMasters([]);
  }, [projectId]);

  useEffect(() => {
    const api = window.csocketApi;
    if (!api?.onVerifyProject) return;
    const off = api.onVerifyProject((msg) => {
      const known = new Set(plcsRef.current.map((plc) => plc.id));
      setVerifyByPlcId((prev) => ingestProjectVerifyFrame(prev, msg.data, known));
    });
    return off;
  }, []);

  useEffect(() => {
    const api = window.csocketApi;
    if (!api?.onReadMasterStatusPolling) return;
    let received = false;
    let cancelled = false;
    const apply = (msg: unknown) => {
      if (cancelled) return;
      const next = replaceMasterStatusMap(msg);
      if (!next) return;
      received = true;
      setMasterById(next);
    };
    const off = api.onReadMasterStatusPolling(apply);
    void (async () => {
      if (!api.getMasterStatusSnapshot) return;
      const snap = await api.getMasterStatusSnapshot();
      if (cancelled) return;
      if (!shouldApplyMasterStatusSnapshot(received)) return;
      apply(snap);
    })();
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const markMismatchDialogConsumed = useCallback(() => {
    setMismatchDialogConsumed(true);
  }, []);

  const getPlcRuntime = useCallback(
    (plcId: number): PlcRuntimeState =>
      composePlcRuntime(plcId, {
        plcs,
        masterById,
        verify: verifyByPlcId.get(plcId),
        scannedMasters,
      }),
    [plcs, masterById, scannedMasters, verifyByPlcId],
  );

  const runtimes = useMemo(
    () => plcs.map((plc) => getPlcRuntime(plc.id)),
    [plcs, getPlcRuntime],
  );

  const systemStatus = useMemo(() => aggregateSystemStatus(runtimes), [runtimes]);

  const shouldShowMismatchDialog = useMemo(
    () => shouldShowProjectMismatchDialog(runtimes, mismatchDialogConsumed),
    [runtimes, mismatchDialogConsumed],
  );

  const scanAll = useCallback(async (): Promise<ScannedMaster[]> => {
    const result = await window.csocketApi.scanAllMaster([]);
    console.log('result', result);
    if (!isCppAckOk(result) || !Array.isArray(result.data)) return [];
    const masters = result.data as ScannedMaster[];
    setScannedMasters(masters);
    return masters;
  }, []);

  const setSimulationAll = useCallback(async (enabled: boolean) => {
    const send = window.csocketApi?.simulationSwitchPlc;
    if (!send) return;
    if (plcs.length === 0) return;
    setSimulationSwitchPending(true);
    try {
      const result = await send(
        plcs.map((plc) => ({
          deviceId: plc.id,
          switchFlag: enabled ? 1 : 0,
        })),
      );
      if (isCppAckFailed(result)) toast.error("仿真切换失败");
    } catch {
      toast.error("仿真切换失败");
    } finally {
      setSimulationSwitchPending(false);
    }
  }, [plcs]);

  const setSimulation = useCallback(
    async (_plcId: number, enabled: boolean) => {
      await setSimulationAll(enabled);
    },
    [setSimulationAll],
  );

  const allStopAll = useCallback(async () => {
    const send = window.csocketApi?.allStopPlc;
    if (!send) return;
    if (plcs.length === 0) return;
    try {
      const result = await send(plcs.map((plc) => ({ deviceId: plc.id })));
      if (isCppAckFailed(result)) toast.error("急停失败");
    } catch {
      toast.error("急停失败");
    }
  }, [plcs]);

  const value = useMemo(
    () => ({
      getPlcRuntime,
      runtimes,
      systemStatus,
      scannedMasters,
      scanAll,
      setSimulation,
      setSimulationAll,
      allStopAll,
      simulationSwitchPending,
      shouldShowMismatchDialog,
      markMismatchDialogConsumed,
    }),
    [
      getPlcRuntime,
      runtimes,
      scanAll,
      scannedMasters,
      setSimulation,
      setSimulationAll,
      allStopAll,
      simulationSwitchPending,
      systemStatus,
      shouldShowMismatchDialog,
      markMismatchDialogConsumed,
    ],
  );

  return <PlcRuntimeContext.Provider value={value}>{children}</PlcRuntimeContext.Provider>;
};

export const usePlcRuntime = () => {
  const context = useContext(PlcRuntimeContext);
  if (!context) {
    throw new Error("usePlcRuntime must be used within PlcRuntimeProvider");
  }
  return context;
};

export const useSystemStatus = (): AggregatedSystemStatus => {
  const { systemStatus } = usePlcRuntime();
  return systemStatus;
};
