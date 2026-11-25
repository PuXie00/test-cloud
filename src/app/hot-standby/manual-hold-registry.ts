/**
 * 本机正在手动驱动的设备（点动按住期间），主备热备发给另一台作「在用」（方案 6.4）。
 * 点动从按下到松开都在发送函数里记，组件卸载时松开也会走到这里。
 */
type Listener = () => void;

const holds = new Map<string, readonly number[]>();
const listeners = new Set<Listener>();
let snapshot: readonly number[] = [];

const publish = () => {
  const ids = new Set<number>();
  for (const list of holds.values()) for (const id of list) ids.add(id);
  snapshot = [...ids].sort((a, b) => a - b);
  for (const listener of listeners) listener();
};

/** key 区分来源（物体点动、调试里的电机点动）；ids 为空或 null 表示松开 */
export const setManualHold = (key: string, ids: readonly number[] | null): void => {
  if (!ids || ids.length === 0) {
    if (!holds.delete(key)) return;
  } else {
    holds.set(key, [...ids]);
  }
  publish();
};

export const getManualHoldIds = (): readonly number[] => snapshot;

export const subscribeManualHolds = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
