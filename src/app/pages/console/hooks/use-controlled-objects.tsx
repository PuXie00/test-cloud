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
  pruneLiveMap,
  type AxisInfoPollingItem,
  type ModelInfoPollingItem,
} from "./monitor-polling";
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
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const motorsRef = useRef(motors);
  motorsRef.current = motors;

  const modelLiveRef = useRef(new Map<number, ModelInfoPollingItem>());
  const axisLiveRef = useRef(new Map<number, AxisInfoPollingItem>());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const known = new Set(objects.map((object) => object.id));
    modelLiveRef.current = pruneLiveMap(modelLiveRef.current, known);
    setTick((value) => value + 1);
  }, [objects]);

  useEffect(() => {
    const known = new Set(motors.map((motor) => motor.id));
    axisLiveRef.current = pruneLiveMap(axisLiveRef.current, known);
    setTick((value) => value + 1);
  }, [motors]);

  useEffect(() => {
    const api = window.csocketApi;
    if (!api?.onReadModelInfoPolling || !api?.onReadAxisInfoPolling) return;
    const bump = () => setTick((value) => value + 1);
    const offModel = api.onReadModelInfoPolling((msg) => {
      console.log('msg', msg)
      const known = new Set(objectsRef.current.map((object) => object.id));
      modelLiveRef.current = ingestPollingFrame(
        modelLiveRef.current,
        msg as CppAckResult<ModelInfoPollingItem>,
        known,
      );
      bump();
    });
    const offAxis = api.onReadAxisInfoPolling((msg) => {
      const known = new Set(motorsRef.current.map((motor) => motor.id));
      axisLiveRef.current = ingestPollingFrame(
        axisLiveRef.current,
        msg as CppAckResult<AxisInfoPollingItem>,
        known,
      );
      bump();
    });
    return () => {
      offModel();
      offAxis();
    };
  }, []);

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

export const useControlledObjects = (): ControlledObjectsContextValue => {
  const value = useContext(ControlledObjectsContext);
  if (!value) throw new Error("useControlledObjects must be used inside ControlledObjectsProvider");
  return value;
};
