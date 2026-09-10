export type MotorSelectionChangeCallback = (id: string | null) => void;

export class MotorSelectionManager {
  private motorId: string | null = null;

  constructor(private readonly onChange: MotorSelectionChangeCallback) {}

  getSelection(): string | null {
    return this.motorId;
  }

  set(id: string | null): void {
    if (this.motorId === id) {
      return;
    }
    this.motorId = id;
    this.onChange(id);
  }

  clear(): void {
    this.set(null);
  }
}
