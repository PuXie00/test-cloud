import type { Camera, Scene } from "@babylonjs/core";
import { Matrix, Vector3 } from "@babylonjs/core";
import type { SlotRect } from "../types";

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

  ensureOverlay(width: number, height: number, host: HTMLElement): HTMLDivElement {
    if (!this.overlay) {
      this.overlay = document.createElement("div");
      this.overlay.style.position = "absolute";
      this.overlay.style.top = "0";
      this.overlay.style.left = "0";
      this.overlay.style.pointerEvents = "none";
      this.overlay.style.zIndex = "10";
      this.overlay.style.overflow = "hidden";
    }
    if (this.overlay.parentElement !== host) {
      host.appendChild(this.overlay);
    }
    this.host = host;
    this.overlay.style.width = `${width}px`;
    this.overlay.style.height = `${height}px`;
    return this.overlay;
  }

  render(scene: Scene, camera: Camera, slotRect: SlotRect, host: HTMLElement): void {
    const { width, height } = slotRect;
    if (width <= 0 || height <= 0) {
      return;
    }
    this.ensureOverlay(width, height, host);
    const engine = scene.getEngine();
    const renderWidth = engine.getRenderWidth();
    const renderHeight = engine.getRenderHeight();
    const scaleX = renderWidth > 0 ? width / renderWidth : 1;
    const scaleY = renderHeight > 0 ? height / renderHeight : 1;
    const transformMatrix = scene.getTransformMatrix();
    const viewport = camera.viewport.toGlobal(renderWidth, renderHeight);

    for (const label of this.labels) {
      if (!label.visible) {
        label.element.style.display = "none";
        continue;
      }
      const projected = Vector3.Project(
        label.worldPosition,
        Matrix.Identity(),
        transformMatrix,
        viewport,
      );
      const inFront = projected.z >= 0 && projected.z <= 1;
      if (!inFront) {
        label.element.style.display = "none";
        continue;
      }
      label.element.style.display = "block";
      label.element.style.position = "absolute";
      label.element.style.left = `${projected.x * scaleX}px`;
      label.element.style.top = `${projected.y * scaleY}px`;
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
