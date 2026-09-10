import type { CameraPose } from "../types";

const clonePose = (pose: CameraPose): CameraPose => ({
  position: { ...pose.position },
  target: { ...pose.target },
});

export class ViewportSaver {
  private readonly saved = new Map<string, CameraPose>();

  save(name: string, pose: CameraPose): void {
    this.saved.set(name, clonePose(pose));
  }

  restore(name: string): CameraPose | undefined {
    const pose = this.saved.get(name);
    return pose ? clonePose(pose) : undefined;
  }

  has(name: string): boolean {
    return this.saved.has(name);
  }

  list(): string[] {
    return [...this.saved.keys()];
  }

  delete(name: string): boolean {
    return this.saved.delete(name);
  }

  clear(): void {
    this.saved.clear();
  }
}
