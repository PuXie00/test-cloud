import { useSyncExternalStore } from "react";

let holding = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getLivePoseHold = (): boolean => holding;

export const setLivePoseHold = (next: boolean): void => {
  if (holding === next) return;
  holding = next;
  emit();
};

export const subscribeLivePoseHold = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useLivePoseHold = (): boolean =>
  useSyncExternalStore(subscribeLivePoseHold, getLivePoseHold, () => false);
