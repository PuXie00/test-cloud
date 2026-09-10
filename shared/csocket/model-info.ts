import { isCppAckOk } from "./ack";

export const MODEL_INFO_KEYS = [
  "modelStatus",
  "virtualAxisHPosition",
  "virtualAxisPPosition",
  "virtualAxisYPosition",
] as const;

export const MODEL_INFO_STALE_MS = 3000;

export type ModelInfo = {
  deviceId: number;
  modelStatus?: number;
  virtualAxisHPosition?: number;
  virtualAxisPPosition?: number;
  virtualAxisYPosition?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isSameModelInfo = (prev: ModelInfo | undefined, next: ModelInfo): boolean => {
  if (!prev) return false;
  const nextKeys = Object.keys(next);
  if (nextKeys.length !== Object.keys(prev).length) return false;
  for (const key of nextKeys) {
    if (prev[key as keyof ModelInfo] !== next[key as keyof ModelInfo]) return false;
  }
  return true;
};

const parseModelItem = (raw: unknown): ModelInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isFiniteNumber(item.deviceId)) return null;
  const parsed: ModelInfo = { deviceId: item.deviceId };
  for (const key of MODEL_INFO_KEYS) {
    if (isFiniteNumber(item[key])) parsed[key] = item[key];
  }
  return parsed;
};

export class ModelInfoStore {
  private readonly lastByDeviceId = new Map<number, ModelInfo>();
  private staleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onStale?: () => void) {}

  clear(): void {
    this.lastByDeviceId.clear();
  }

  ingest(result: unknown): ModelInfo[] | null {
    this.armStale();
    if (!isCppAckOk(result) || !Array.isArray(result.data)) return null;
    const pending = new Map<number, ModelInfo>();
    const order: number[] = [];
    for (const raw of result.data) {
      const parsed = parseModelItem(raw);
      if (!parsed) continue;
      const base = pending.get(parsed.deviceId) ?? this.lastByDeviceId.get(parsed.deviceId) ?? {
        deviceId: parsed.deviceId,
      };
      if (!pending.has(parsed.deviceId)) order.push(parsed.deviceId);
      pending.set(parsed.deviceId, { ...base, ...parsed });
    }
    if (order.length === 0) return null;
    let changed = false;
    for (const id of order) {
      const next = pending.get(id);
      if (!next || isSameModelInfo(this.lastByDeviceId.get(id), next)) continue;
      changed = true;
    }
    if (!changed) return null;
    for (const id of order) {
      const next = pending.get(id);
      if (next) this.lastByDeviceId.set(id, next);
    }
    return order.map((id) => pending.get(id)!);
  }

  private armStale(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    const timer = setTimeout(() => {
      this.staleTimer = undefined;
      this.lastByDeviceId.clear();
      this.onStale?.();
    }, MODEL_INFO_STALE_MS);
    timer.unref?.();
    this.staleTimer = timer;
  }
}
