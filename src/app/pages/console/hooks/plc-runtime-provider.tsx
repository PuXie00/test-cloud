import { usePermissions } from "@/app/auth/permissions";
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
import { reconcilePlcOnline, type PlcOnline } from "./plc-online";
import {
  INITIAL_MASTER_SCAN_STATE,
  type MasterScanState,
  type PlcRuntimeState,
  type ScannedMaster,
} from "./plc-runtime-types";
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
  /** 最近一次扫描主控；工程结构的「在线」只看它 */
  scan: MasterScanState;
  /** 按扫描结果对出来的主控 / 电机在线情况 */
  getPlcOnline: (plcId: number) => PlcOnline;
  /** 扫描主控；正在扫描时复用同一次。失败时抛错（扫描状态记下原因） */
  scanAll: () => Promise<ScannedMaster[]>;
  /** 后台扫描：不弹提示，失败只记在扫描状态里（新增主控后、打开工程时用） */
  scanInBackground: () => void;
  setSimulation: (plcId: number, enabled: boolean) => Promise<void>;
  setSimulationAll: (enabled: boolean) => Promise<void>;
  allStopAll: () => Promise<void>;
  simulationSwitchPending: boolean;
  shouldShowMismatchDialog: boolean;
  markMismatchDialogConsumed: () => void;
};

const PlcRuntimeContext = createContext<PlcRuntimeContextValue | null>(null);

const describeScanFailure = (result: unknown): string => {
  const code = (result as { code?: unknown } | null | undefined)?.code;
  if (code === "NOT_CONNECTED" || code === "SEND_FAILED") return "扫描失败：控制服务未连接";
  return "扫描失败";
};

export const PlcRuntimeProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject } = useProject();
  const projectId = currentProject?.id;
  const { plcs, motors } = useProjectStore();
  const plcsRef = useRef(plcs);
  plcsRef.current = plcs;
  // 切换仿真要「主控操作」：界面已只读，这里再拦一次
  const canOperateMaster = usePermissions().can("build.plc");
  const canOperateMasterRef = useRef(canOperateMaster);
  canOperateMasterRef.current = canOperateMaster;
  const [scan, setScan] = useState<MasterScanState>(INITIAL_MASTER_SCAN_STATE);
  const scanInFlightRef = useRef<Promise<ScannedMaster[]> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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

  // 换工程清掉上一次的扫描结果，扫描中的那次回来照常记下（扫的是网络，不分工程）
  const autoScannedProjectRef = useRef<string | null>(null);
  // 子组件的 effect 先于工程数据层换数据：换工程这一刻的 plcs 还是上一个工程的
  const plcsAtProjectSwitchRef = useRef<typeof plcs | null>(null);
  useEffect(() => {
    autoScannedProjectRef.current = null;
    plcsAtProjectSwitchRef.current = plcsRef.current;
    setScan((prev) => ({ ...INITIAL_MASTER_SCAN_STATE, scanning: prev.scanning }));
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

  // 主进程只在主控状态变化时广播；切换工程后同一批主控状态不变就不会再推，必须按工程重拉快照
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
  }, [projectId]);

  const markMismatchDialogConsumed = useCallback(() => {
    setMismatchDialogConsumed(true);
  }, []);

  const getPlcRuntime = useCallback(
    (plcId: number): PlcRuntimeState =>
      composePlcRuntime(plcId, {
        masterById,
        verify: verifyByPlcId.get(plcId),
      }),
    [masterById, verifyByPlcId],
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

  const onlineByPlcId = useMemo(() => {
    const map = new Map<number, PlcOnline>();
    for (const plc of plcs) map.set(plc.id, reconcilePlcOnline(plc, motors, scan.masters));
    return map;
  }, [motors, plcs, scan.masters]);

  const getPlcOnline = useCallback(
    (plcId: number): PlcOnline =>
      onlineByPlcId.get(plcId) ??
      reconcilePlcOnline({ id: plcId, ip: "", masterTypeId: "" }, [], scan.masters),
    [onlineByPlcId, scan.masters],
  );

  const scanAll = useCallback((): Promise<ScannedMaster[]> => {
    if (scanInFlightRef.current) return scanInFlightRef.current;
    setScan((prev) => (prev.scanning ? prev : { ...prev, scanning: true }));
    const run = (async () => {
      // 让下面先把这次记进 scanInFlightRef，同步出错时 finally 也不会把它留在里面
      await Promise.resolve();
      try {
        const send = window.csocketApi?.scanAllMaster;
        if (!send) throw new Error("控制服务不可用");
        const result = await send([]);
        if (!isCppAckOk(result) || !Array.isArray(result.data)) {
          throw new Error(describeScanFailure(result));
        }
        const masters = result.data as ScannedMaster[];
        if (mountedRef.current) {
          setScan({ masters, at: Date.now(), scanning: false, error: null });
        }
        return masters;
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "扫描失败";
        if (mountedRef.current) {
          setScan((prev) => ({ ...prev, scanning: false, error: message }));
        }
        throw new Error(message);
      } finally {
        scanInFlightRef.current = null;
      }
    })();
    scanInFlightRef.current = run;
    return run;
  }, []);

  const scanInBackground = useCallback(() => {
    void scanAll().catch(() => {});
  }, [scanAll]);

  // 打开有主控的工程时扫描一次，工程结构才知道哪些主控、电机在线（每次打开一次）
  useEffect(() => {
    if (!projectId || plcs.length === 0) return;
    if (plcs === plcsAtProjectSwitchRef.current) return;
    if (autoScannedProjectRef.current === projectId) return;
    autoScannedProjectRef.current = projectId;
    scanInBackground();
  }, [plcs, projectId, scanInBackground]);

  const setSimulationAll = useCallback(async (enabled: boolean) => {
    const send = window.csocketApi?.simulationSwitchPlc;
    if (!send || !canOperateMasterRef.current) return;
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
      scan,
      getPlcOnline,
      scanAll,
      scanInBackground,
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
      scan,
      getPlcOnline,
      scanAll,
      scanInBackground,
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

/** 聚合状态是否「正常」；不在 PlcRuntimeProvider 里（只渲染局部的单元测试）时按正常 */
export const useSystemStatusNormal = (): boolean => {
  const context = useContext(PlcRuntimeContext);
  return context ? context.systemStatus.kind === "normal" : true;
};

/**
 * 聚合状态「正常」时监控才处理 Info|model / Info|axis / Info|act；
 * 工程不匹配、挂起、初始化等都不处理，物体和电机按离线显示。
 */
export const useTelemetryListening = (): boolean => useSystemStatusNormal();
