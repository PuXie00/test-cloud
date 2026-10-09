export type MotorSelectionChangeCallback = (ids: string[]) => void;

export class MotorSelectionManager {
  private motorIds: string[] = [];

  constructor(private readonly onChange: MotorSelectionChangeCallback) {}

  getSelection(): string[] {
    return [...this.motorIds];
  }

  set(ids: readonly string[]): void {
    const next = [...new Set(ids)];
    if (next.length === this.motorIds.length && next.every((id, index) => id === this.motorIds[index])) {
      return;
    }
    this.motorIds = next;
    this.onChange([...next]);
  }

  clear(): void {
    this.set([]);
  }
}
