import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CppAckResult } from "../../../../../shared/csocket/types";
import type {
  ControlledObjectSnapshot,
  MotorMonitorSnapshot,
} from "../components/monitor-grid/monitor-data";
import {
  buildMotorSnapshots,
  buildObjectSnapshots,
  ingestPollingFrame,
  mergePollingSnapshot,
  type AxisInfoPollingItem,
  type ModelInfoPollingItem,
} from "./monitor-polling";
import { useTelemetryListening } from "./plc-runtime-provider";
import { useProjectStore } from "./use-project-store";

type ControlledObjectsContextValue = {
  snapshots: ControlledObjectSnapshot[];
  getById: (id: number) => ControlledObjectSnapshot | undefined;
  motorSnapshots: MotorMonitorSnapshot[];
};

const ControlledObjectsContext = createContext<ControlledObjectsContextValue | null>(null);

type ControlledObjectsProviderProps = { children: ReactNode };

export const ControlledObjectsProvider = ({ children }: ControlledObjectsProviderProps) => {
  const { objects, motors } = useProjectStore();

  const modelLiveRef = useRef(new Map<number, ModelInfoPollingItem>());
  const axisLiveRef = useRef(new Map<number, AxisInfoPollingItem>());
  const [tick, setTick] = useState(0);
  const listening = useTelemetryListening();

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    if (!listening) {
      // 聚合状态不正常时不监听，已收到的值也清掉：物体、电机都按离线显示
      if (modelLiveRef.current.size > 0 || axisLiveRef.current.size > 0) {
        modelLiveRef.current = new Map();
        axisLiveRef.current = new Map();
        bump();
      }
      return;
    }
    const api = window.csocketApi;
    if (!api?.onReadModelInfoPolling || !api?.onReadAxisInfoPolling) return;
    let cancelled = false;
    const offModel = api.onReadModelInfoPolling((msg) => {
      modelLiveRef.current = ingestPollingFrame(
        modelLiveRef.current,
        msg as CppAckResult<ModelInfoPollingItem>,
      );
      bump();
    });
    const offAxis = api.onReadAxisInfoPolling((msg) => {
      axisLiveRef.current = ingestPollingFrame(
        axisLiveRef.current,
        msg as CppAckResult<AxisInfoPollingItem>,
      );
      bump();
    });
    // 主进程只在数值变化时转发；打开工程时物体静止就一帧都收不到，先补一次主进程缓存
    void (async () => {
      const [modelSnapshot, axisSnapshot] = await Promise.all([
        api.getModelInfoSnapshot?.(),
        api.getAxisInfoSnapshot?.(),
      ]);
      if (cancelled) return;
      if (modelSnapshot) {
        modelLiveRef.current = mergePollingSnapshot(
          modelLiveRef.current,
          modelSnapshot as CppAckResult<ModelInfoPollingItem>,
        );
      }
      if (axisSnapshot) {
        axisLiveRef.current = mergePollingSnapshot(
          axisLiveRef.current,
          axisSnapshot as CppAckResult<AxisInfoPollingItem>,
        );
      }
      bump();
    })();
    return () => {
      cancelled = true;
      offModel();
      offAxis();
    };
  }, [listening]);

  const snapshots = useMemo(
    () => buildObjectSnapshots(objects, modelLiveRef.current),
    [objects, tick],
  );
  const motorSnapshots = useMemo(
    () => buildMotorSnapshots(motors, axisLiveRef.current),
    [motors, tick],
  );

  const value = useMemo<ControlledObjectsContextValue>(
    () => ({
      snapshots,
      motorSnapshots,
      getById: (id) => snapshots.find((entry) => entry.descriptor.id === id),
    }),
    [snapshots, motorSnapshots],
  );

  return (
    <ControlledObjectsContext.Provider value={value}>{children}</ControlledObjectsContext.Provider>
  );
};

export const useOptionalControlledObjects = (): ControlledObjectsContextValue | null =>
  useContext(ControlledObjectsContext);

export const useControlledObjects = (): ControlledObjectsContextValue => {
  const value = useContext(ControlledObjectsContext);
  if (!value) throw new Error("useControlledObjects must be used inside ControlledObjectsProvider");
  return value;
};
