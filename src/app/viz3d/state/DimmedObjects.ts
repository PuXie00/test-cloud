import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";

type DimTarget = Pick<SceneObjectHandle, "id" | "setDimmed">;

/** 记录需要变淡的物体 id；handle 重建后可重复 apply */
export class DimmedObjects {
  private ids = new Set<string>();

  set(ids: string[]): void {
    this.ids = new Set(ids);
  }

  apply(handles: Iterable<DimTarget>): void {
    for (const handle of handles) {
      handle.setDimmed(this.ids.has(handle.id));
    }
  }

  clear(): void {
    this.ids.clear();
  }
}
