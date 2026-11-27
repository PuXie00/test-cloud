export type Steps<T> = Generator<void, T, void>;
export type RunSteps = <T>(steps: Steps<T>) => Promise<T>;

/** 同步调用与后台分片执行消费同一个迭代器。 */
export function finishSteps<T>(steps: Steps<T>): T {
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export class WorkerJob {
  private paused = false;
  private cancelled = false;
  private wake?: () => void;
  private deadline: number;

  constructor(readonly id: number, private readonly sliceMs = 6) {
    this.deadline = performance.now() + sliceMs;
  }

  pause() { this.paused = true; }

  resume() {
    this.paused = false;
    this.wake?.();
  }

  cancel() {
    this.cancelled = true;
    this.wake?.();
  }

  /** No polling while paused. Recheck after every await, including an in-flight model decode. */
  async ready(): Promise<void> {
    // Carry the deadline through all phases: even many individually cheap shapes yield to input.
    if (!this.paused && !this.cancelled && performance.now() >= this.deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.deadline = performance.now() + this.sliceMs;
    }
    while (this.paused && !this.cancelled) {
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
    if (this.cancelled) throw new Error("碰撞校验已取消");
  }

  readonly run: RunSteps = async <T>(steps: Steps<T>): Promise<T> => {
    try {
      for (;;) {
        await this.ready();
        do {
          const result = steps.next();
          if (result.done) return result.value;
        } while (performance.now() < this.deadline);
      }
    } finally {
      steps.return(undefined as T);
    }
  };
}
