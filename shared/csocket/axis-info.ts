import { isCppAckOk } from "./ack";

export const AXIS_INFO_STALE_MS = 3000;

export type AxisInfo = {
  deviceId: number;
  [key: string]: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isSameAxisInfo = (prev: AxisInfo | undefined, next: AxisInfo): boolean => {
  if (!prev) return false;
  const nextKeys = Object.keys(next);
  if (nextKeys.length !== Object.keys(prev).length) return false;
  for (const key of nextKeys) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
};

const parseAxisItem = (raw: unknown): AxisInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (!isFiniteNumber(item.deviceId)) return null;
  const parsed: AxisInfo = { deviceId: item.deviceId };
  for (const [key, value] of Object.entries(item)) {
    if (!isFiniteNumber(value)) continue;
    parsed[key] = value;
  }
  return parsed;
};

export class AxisInfoStore {
  private readonly lastByDeviceId = new Map<number, AxisInfo>();
  private staleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onStale?: () => void) {}

  clear(): void {
    this.lastByDeviceId.clear();
  }

  ingest(result: unknown): AxisInfo[] | null {
    this.armStale();
    if (!isCppAckOk(result) || !Array.isArray(result.data)) return null;
    const pending = new Map<number, AxisInfo>();
    const order: number[] = [];
    for (const raw of result.data) {
      const parsed = parseAxisItem(raw);
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
      if (!next || isSameAxisInfo(this.lastByDeviceId.get(id), next)) continue;
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
    }, AXIS_INFO_STALE_MS);
    timer.unref?.();
    this.staleTimer = timer;
  }
}
