import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { DomLabelEntry } from "../labels/DomLabelRenderer";
import type { Disposable, DriveUnitLabelFields, SceneObjectStatus } from "../types";

export class DriveUnitLabels implements Disposable {
  readonly entry: DomLabelEntry;
  private readonly element: HTMLDivElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "viz3d-drive-unit-label";

    this.entry = {
      element: this.element,
      worldPosition: new Vector3(0, 1.2, 0),
      visible: false,
    };
  }

  /** 标签背景随物体状态变化：运行绿色、报警红色，其余状态用默认样式（样式见 theme.css） */
  setStatus(status: SceneObjectStatus | undefined): void {
    if (status === "running" || status === "alarm") {
      this.element.dataset.status = status;
      return;
    }
    delete this.element.dataset.status;
  }

  setWorldPosition(position: Vector3): void {
    this.entry.worldPosition.copyFrom(position);
  }

  update(fields: DriveUnitLabelFields | null): void {
    if (!fields) {
      this.entry.visible = false;
      this.element.textContent = "";
      return;
    }
    const lines: string[] = [];
    if (fields.id) lines.push(fields.id);
    if (fields.position) lines.push(fields.position);
    if (fields.speed) lines.push(fields.speed);
    if (fields.load) lines.push(fields.load);
    this.element.textContent = lines.join("\n");
    this.entry.visible = lines.length > 0;
  }

  dispose(): void {
    this.entry.element.remove();
  }
}
