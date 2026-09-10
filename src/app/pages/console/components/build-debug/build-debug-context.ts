import { createContext, useContext } from "react";
import type { BuildMotorTelemetry, JogStep } from "./build-debug-types";

export type BuildDebugContextValue = {
  armed: boolean;
  primaryMotorId: number | null;
  selectedMotorIds: ReadonlySet<number>;
  pinnedMotorIds: ReadonlySet<number>;
  /** 耦合中的受控物体；默认空 = 全部解耦 */
  coupledObjectIds: ReadonlySet<number>;
  stepMm: JogStep;
  arm: () => void;
  disarm: () => void;
  setPrimary: (motorId: number | null) => void;
  toggleMotor: (motorId: number, additive?: boolean) => void;
  selectMotors: (motorIds: number[], primaryId?: number | null) => void;
  clearSelection: () => void;
  togglePin: (motorId: number) => void;
  setStep: (step: JogStep) => void;
  isObjectDecoupled: (objectId: number) => boolean;
  /** 物体下至少有一台已连接电机时可切换耦合 */
  canToggleObjectCoupling: (objectId: number) => boolean;
  setObjectDecoupled: (objectId: number, decoupled: boolean) => void;
  setAllObjectsDecoupled: (decoupled: boolean) => void;
  /** 在线且所属物体已解耦（未绑定电机视为可解耦） */
  isMotorSelectable: (motorId: number) => boolean;
  telemetryOf: (motorId: number) => BuildMotorTelemetry;
  displayPositionOf: (motorId: number) => number;
  imbalancedInObject: (objectId: number) => ReadonlySet<number>;
  isMotorOnline: (motorId: number) => boolean;
  setEnabled: (motorIds: number[], enabled: boolean) => void;
  jogStart: (dir: 1 | -1) => void;
  jogStop: () => void;
  stop: () => void;
  setOrigin: (motorIds: number[]) => void;
  moveTo: (position: number) => void;
  stepPrimary: (dir: 1 | -1) => void;
};

/** 独立文件：避免 HMR 重建 Provider 模块时 Context 身份漂移 */
export const BuildDebugContext = createContext<BuildDebugContextValue | null>(null);

export const useBuildDebug = (): BuildDebugContextValue => {
  const ctx = useContext(BuildDebugContext);
  if (!ctx) throw new Error("useBuildDebug must be used within BuildDebugProvider");
  return ctx;
};

export const useBuildDebugOptional = (): BuildDebugContextValue | null =>
  useContext(BuildDebugContext);
