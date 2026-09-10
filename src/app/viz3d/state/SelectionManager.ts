import type { SelectionMode } from "../types";

export type SelectionChangeCallback = (ids: string[]) => void;

export class SelectionManager {
  private selected: string[] = [];

  constructor(private readonly onChange: SelectionChangeCallback) {}

  getSelection(): string[] {
    return [...this.selected];
  }

  set(ids: string[]): void {
    const next = [...new Set(ids)];
    if (this.sameSelection(next)) {
      return;
    }
    this.selected = next;
    this.onChange(this.getSelection());
  }

  select(id: string, mode: SelectionMode): void {
    if (mode === "single") {
      this.set([id]);
      return;
    }
    const next = this.selected.includes(id)
      ? this.selected.filter((value) => value !== id)
      : [...this.selected, id];
    this.set(next);
  }

  clear(): void {
    this.set([]);
  }

  private sameSelection(next: string[]): boolean {
    if (next.length !== this.selected.length) {
      return false;
    }
    const current = new Set(this.selected);
    return next.every((id) => current.has(id));
  }
}
