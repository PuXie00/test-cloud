import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { GreasedLineMesh } from "@babylonjs/core/Meshes/GreasedLine/greasedLineMesh";
import {
  createSelectionBoxHelper,
  disposeSelectionBoxHelper,
  setBoxHelperColor,
  updateSelectionBoxHelper,
} from "../objects/SelectionBoxHelper";

export type TransformNodeLookup = (id: string) => TransformNode | undefined;

export class SelectionBoxManager {
  private boxes = new Map<string, GreasedLineMesh>();
  private motorBoxes = new Map<string, GreasedLineMesh>();
  private colorHex: string;

  constructor(
    private readonly getObject: TransformNodeLookup,
    colorHex: string,
  ) {
    this.colorHex = colorHex;
  }

  syncObjects(ids: string[], lookup?: TransformNodeLookup): void {
    this.syncBoxSet(ids, this.boxes, lookup ?? this.getObject);
  }

  syncMotors(ids: string[], lookup: TransformNodeLookup): void {
    this.syncBoxSet(ids, this.motorBoxes, lookup);
  }

  private syncBoxSet(
    ids: string[],
    boxes: Map<string, GreasedLineMesh>,
    lookup: TransformNodeLookup,
  ): void {
    const next = new Set(ids);

    for (const [id, box] of boxes) {
      if (!next.has(id)) {
        disposeSelectionBoxHelper(box);
        boxes.delete(id);
      }
    }

    for (const id of ids) {
      if (boxes.has(id)) {
        continue;
      }
      const object = lookup(id);
      if (!object) {
        continue;
      }
      boxes.set(id, createSelectionBoxHelper(object, this.colorHex, id));
    }
  }

  update(): void {
    if (this.boxes.size === 0 && this.motorBoxes.size === 0) {
      return;
    }
    for (const box of this.boxes.values()) {
      updateSelectionBoxHelper(box);
    }
    for (const box of this.motorBoxes.values()) {
      updateSelectionBoxHelper(box);
    }
  }

  setColor(colorHex: string): void {
    this.colorHex = colorHex;
    for (const box of this.boxes.values()) {
      setBoxHelperColor(box, colorHex);
    }
    for (const box of this.motorBoxes.values()) {
      setBoxHelperColor(box, colorHex);
    }
  }

  dispose(): void {
    for (const box of this.boxes.values()) {
      disposeSelectionBoxHelper(box);
    }
    this.boxes.clear();
    for (const box of this.motorBoxes.values()) {
      disposeSelectionBoxHelper(box);
    }
    this.motorBoxes.clear();
  }
}
