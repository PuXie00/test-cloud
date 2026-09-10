export type Listener<T> = (payload: T) => void;

export class Emitter<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<unknown>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    const listenersByEvent = this.listeners.get(event) ?? new Set<Listener<unknown>>();
    listenersByEvent.add(listener as Listener<unknown>);
    this.listeners.set(event, listenersByEvent);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners
      .get(event)
      ?.forEach((listener) => (listener as Listener<EventMap[K]>)(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}
