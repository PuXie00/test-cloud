import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { DomLabelEntry, DomLabelRenderer } from "../labels/DomLabelRenderer";
import { hexToColor3 } from "../babylon/utils";
import type { Disposable, Vec3 } from "../types";

const hexToCss = (hex: number): string => `#${hex.toString(16).padStart(6, "0").slice(-6)}`;

export class MeasureMarkers implements Disposable {
  private readonly line: LinesMesh;
  private readonly segmentPoints = [new Vector3(), new Vector3()];
  private readonly labelPosition = new Vector3();
  private readonly labelEntry: DomLabelEntry;
  private readonly labelElement: HTMLDivElement;
  private readonly labelRenderer: DomLabelRenderer;
  private hasSegment = false;

  constructor(
    scene: Scene,
    labelRenderer: DomLabelRenderer,
    primaryColor: number,
    foregroundColor: number,
  ) {
    this.labelRenderer = labelRenderer;
    this.line = MeshBuilder.CreateLines(
      "viz3d-measure-line",
      { points: [Vector3.Zero(), Vector3.Zero()], updatable: true },
      scene,
    );
    this.line.color = hexToColor3(primaryColor);
    this.line.isPickable = false;
    this.line.setEnabled(false);

    this.labelElement = document.createElement("div");
    this.labelElement.style.fontFamily = "monospace";
    this.labelElement.style.fontSize = "13px";
    this.labelElement.style.lineHeight = "18px";
    this.labelElement.style.color = hexToCss(foregroundColor);
    this.labelElement.style.pointerEvents = "none";
    this.labelElement.style.whiteSpace = "nowrap";

    this.labelEntry = {
      element: this.labelElement,
      worldPosition: this.labelPosition,
      visible: false,
    };
    labelRenderer.add(this.labelEntry);
  }

  setSegment(a: Vec3, b: Vec3, label?: string): void {
    this.segmentPoints[0].set(a.x, a.y, a.z);
    this.segmentPoints[1].set(b.x, b.y, b.z);
    MeshBuilder.CreateLines(
      "viz3d-measure-line",
      {
        points: this.segmentPoints,
        instance: this.line,
      },
      this.line.getScene() ?? undefined,
    );
    this.hasSegment = true;
    this.line.setEnabled(true);

    if (label) {
      this.labelElement.textContent = label;
      this.labelPosition.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      this.labelEntry.visible = true;
    } else {
      this.labelElement.textContent = "";
      this.labelEntry.visible = false;
    }
  }

  setVisible(on: boolean): void {
    this.line.setEnabled(on && this.hasSegment);
    if (!on) {
      this.labelEntry.visible = false;
      return;
    }
    this.labelEntry.visible = this.labelElement.textContent.length > 0;
  }

  clear(): void {
    this.segmentPoints[0].set(0, 0, 0);
    this.segmentPoints[1].set(0, 0, 0);
    MeshBuilder.CreateLines(
      "viz3d-measure-line",
      { points: this.segmentPoints, instance: this.line },
      this.line.getScene() ?? undefined,
    );
    this.hasSegment = false;
    this.line.setEnabled(false);
    this.labelElement.textContent = "";
    this.labelEntry.visible = false;
  }

  dispose(): void {
    this.line.dispose();
    this.labelRenderer.remove(this.labelEntry);
  }
}
