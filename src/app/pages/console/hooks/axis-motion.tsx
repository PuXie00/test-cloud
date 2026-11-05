import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { downloadBlockedByMotionMessage, movingAxisIds } from "@shared/csocket/axis-info";
import { usePermissions } from "@/app/auth/permissions";
import { useProject } from "@/app/project/use-project";

export type AxisMotion = {
  /** 正在运动的轴 id（升序） */
  movingAxisIds: readonly number[];
};

/** 轴运动时各处不能做的事，null 表示不受限（动作保存看对应动作是否在运行，见 action-run） */
export type AxisMotionLocks = {
  setup: string | null;
  download: string | null;
};

const NO_MOTION: AxisMotion = { movingAxisIds: [] };

const NO_LOCKS: AxisMotionLocks = { setup: null, download: null };

export const axisMotionLocks = (movingCount: number): AxisMotionLocks =>
  movingCount === 0
    ? NO_LOCKS
    : {
        setup: `${movingCount} 个轴运动中，搭建暂时只读`,
        download: downloadBlockedByMotionMessage(movingCount),
      };

type AxisStatusFrame = { success?: unknown; data?: unknown };

const finiteOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * 把一帧 Info|axis 并进「轴 id → axisStatus」：空帧表示主控那边清空了（断开 / 超时）。
 * fillOnly 用于补主进程快照：已经收到实时帧的轴不覆盖。
 */
export const ingestAxisStatusFrame = (
  statusById: Map<number, number | undefined>,
  frame: AxisStatusFrame | null | undefined,
  fillOnly = false,
): void => {
  if (!frame || frame.success !== true || !Array.isArray(frame.data)) return;
  if (frame.data.length === 0) {
    if (!fillOnly) statusById.clear();
    return;
  }
  for (const raw of frame.data) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const deviceId = finiteOrUndefined(item.deviceId);
    if (deviceId === undefined) continue;
    if (fillOnly && statusById.has(deviceId)) continue;
    if ("axisStatus" in item) statusById.set(deviceId, finiteOrUndefined(item.axisStatus));
    else if (!statusById.has(deviceId)) statusById.set(deviceId, undefined);
  }
};

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const AxisMotionContext = createContext<AxisMotion>(NO_MOTION);

/**
 * 轴是否在运动（Info|axis 的 axisStatus = 3），主控上报的轴都算，不限当前工程的电机。
 * 不跟监控的聚合状态走：状态不正常时监控不显示实时值，但轴照样可能在动。
 * 只在运动中的轴变化时更新，位置刷新不会引起重渲染。
 */
export const AxisMotionProvider = ({ children }: { children: ReactNode }) => {
  const [moving, setMoving] = useState<readonly number[]>(NO_MOTION.movingAxisIds);

  useEffect(() => {
    const api = window.csocketApi;
    if (!api?.onReadAxisInfoPolling) return;
    let cancelled = false;
    const statusById = new Map<number, number | undefined>();
    const publish = () => {
      const next = movingAxisIds(
        [...statusById].map(([deviceId, axisStatus]) => ({ deviceId, axisStatus })),
      );
      setMoving((prev) => (sameIds(prev, next) ? prev : next));
    };
    const off = api.onReadAxisInfoPolling((msg) => {
      ingestAxisStatusFrame(statusById, msg);
      publish();
    });
    // 主进程只在数值变化时转发，先补一次它缓存的当前值
    void (async () => {
      const snapshot = await api.getAxisInfoSnapshot?.();
      if (cancelled) return;
      ingestAxisStatusFrame(statusById, snapshot, true);
      publish();
    })();
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const value = useMemo<AxisMotion>(() => ({ movingAxisIds: moving }), [moving]);
  return <AxisMotionContext.Provider value={value}>{children}</AxisMotionContext.Provider>;
};

export const useAxisMotion = (): AxisMotion => useContext(AxisMotionContext);

export const useAxisMotionLocks = (): AxisMotionLocks => {
  const count = useAxisMotion().movingAxisIds.length;
  return useMemo(() => axisMotionLocks(count), [count]);
};

export type SetupEditState = { readOnly: boolean; reason: string | null };

const SETUP_EDITABLE: SetupEditState = { readOnly: false, reason: null };
const SETUP_FORBIDDEN: SetupEditState = { readOnly: true, reason: "只读：没有「编辑工程配置」权限" };

/** 搭建能不能改：没有「编辑工程配置」权限或轴运动中都只读，reason 是给界面的说明 */
export const useSetupEditState = (): SetupEditState => {
  const canEdit = usePermissions().can("build.edit");
  const { setup } = useAxisMotionLocks();
  return useMemo(() => {
    if (!canEdit) return SETUP_FORBIDDEN;
    return setup ? { readOnly: true, reason: setup } : SETUP_EDITABLE;
  }, [canEdit, setup]);
};

/** 把轴运动锁交给工程数据层：搭建的修改在那里统一拦 */
export const AxisMotionEditLockSync = () => {
  const { setSetupEditLock } = useProject();
  const { setup } = useAxisMotionLocks();

  useEffect(() => {
    setSetupEditLock(setup);
  }, [setup, setSetupEditLock]);

  useEffect(() => () => setSetupEditLock(null), [setSetupEditLock]);

  return null;
};
