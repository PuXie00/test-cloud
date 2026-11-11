import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SlotRect } from "../types";
import { projectWorldToCell } from "../viewports/project-to-cell";

export type DomLabelEntry = {
  element: HTMLElement;
  worldPosition: Vector3;
  visible: boolean;
};

export class DomLabelRenderer {
  private readonly labels = new Set<DomLabelEntry>();
  private host: HTMLElement | null = null;
  private overlay: HTMLDivElement | null = null;

  add(entry: DomLabelEntry): void {
    this.labels.add(entry);
    if (this.overlay) {
      this.overlay.appendChild(entry.element);
    }
  }

  remove(entry: DomLabelEntry): void {
    this.labels.delete(entry);
    entry.element.remove();
  }

  /** 标签层盖在一格上（多格时只在当前格），超出格子的标签被裁掉 */
  ensureOverlay(cell: SlotRect, host: HTMLElement): HTMLDivElement {
    if (!this.overlay) {
      this.overlay = document.createElement("div");
      this.overlay.style.position = "absolute";
      this.overlay.style.pointerEvents = "none";
      this.overlay.style.zIndex = "10";
      this.overlay.style.overflow = "hidden";
    }
    if (this.overlay.parentElement !== host) {
      host.appendChild(this.overlay);
    }
    this.host = host;
    const style = this.overlay.style;
    const left = `${cell.left}px`;
    const top = `${cell.top}px`;
    const width = `${cell.width}px`;
    const height = `${cell.height}px`;
    if (style.left !== left) style.left = left;
    if (style.top !== top) style.top = top;
    if (style.width !== width) style.width = width;
    if (style.height !== height) style.height = height;
    return this.overlay;
  }

  /** cell：要画标签的那一格在画布里的矩形（CSS px）；camera 必须是这一格的相机 */
  render(camera: Camera, cell: SlotRect, host: HTMLElement): void {
    if (cell.width <= 0 || cell.height <= 0) {
      return;
    }
    this.ensureOverlay(cell, host);
    const local: SlotRect = { left: 0, top: 0, width: cell.width, height: cell.height };

    for (const label of this.labels) {
      if (!label.visible) {
        label.element.style.display = "none";
        continue;
      }
      const projected = projectWorldToCell(label.worldPosition, camera, local);
      if (!projected.inFront) {
        label.element.style.display = "none";
        continue;
      }
      label.element.style.display = "block";
      label.element.style.position = "absolute";
      label.element.style.left = `${projected.x}px`;
      label.element.style.top = `${projected.y}px`;
      label.element.style.transform = "translate(-50%, -50%)";
    }
    void this.host;
  }

  dispose(): void {
    for (const label of this.labels) {
      label.element.remove();
    }
    this.labels.clear();
    this.overlay?.remove();
    this.overlay = null;
    this.host = null;
  }
}
