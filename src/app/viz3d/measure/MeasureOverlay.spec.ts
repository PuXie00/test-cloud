// @vitest-environment jsdom
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeasureOverlay, type MeasureOverlayCell } from "./MeasureOverlay";
import type { MeasureRuler } from "./measure-rulers";

describe("MeasureOverlay", () => {
  let babylon: NullEngine;
  let scene: Scene;
  let host: HTMLDivElement;
  let overlay: MeasureOverlay;
  let cells: MeasureOverlayCell[];

  const rulers: MeasureRuler[] = [
    { id: "r1", a: { x: -1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
    { id: "r2", a: { x: 0, y: 0, z: -1 }, b: { x: 0, y: 1, z: 1 } },
  ];
  const label = (ruler: MeasureRuler) => `${ruler.id} len`;

  beforeEach(() => {
    babylon = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
    scene = new Scene(babylon);
    const left = new ArcRotateCamera("l", -Math.PI / 2, 0.8, 10, Vector3.Zero(), scene);
    const right = new ArcRotateCamera("r", 0, 0.01, 10, Vector3.Zero(), scene);
    scene.activeCameras = [left, right];
    scene.render();
    cells = [
      { id: "main", rect: { left: 0, top: 0, width: 400, height: 600 }, camera: left },
      { id: "dualRight", rect: { left: 400, top: 0, width: 400, height: 600 }, camera: right },
    ];
    host = document.createElement("div");
    overlay = new MeasureOverlay(host);
  });

  afterEach(() => {
    overlay.dispose();
    scene.dispose();
    babylon.dispose();
  });

  const layer = (id: string) => host.querySelector<HTMLDivElement>(`[data-cell-id="${id}"]`)!;
  const labels = (id: string) =>
    [...layer(id).querySelectorAll<HTMLDivElement>(":scope > div")].map((element) => element.textContent);

  it("draws every ruler in every visible cell, with the selected one highlighted", () => {
    overlay.render(cells, rulers, "r2", null, label);
    expect(layer("main").style.width).toBe("400px");
    expect(layer("dualRight").style.left).toBe("400px");
    for (const id of ["main", "dualRight"]) {
      expect(layer(id).querySelectorAll("g")).toHaveLength(2);
      expect(labels(id)).toEqual(["r1 len", "r2 len"]);
    }
    const lines = [...layer("main").querySelectorAll("g")].map((group) => group.querySelectorAll("line")[1]!);
    expect(lines.map((line) => line.getAttribute("stroke"))).toEqual(["var(--foreground)", "var(--primary)"]);
  });

  it("removes deleted rulers and hides cells that are no longer shown", () => {
    overlay.render(cells, rulers, null, null, label);
    overlay.render([cells[0]!], [rulers[0]!], null, null, label);
    expect(layer("main").querySelectorAll("g")).toHaveLength(1);
    expect(labels("main")).toEqual(["r1 len"]);
    expect(layer("dualRight").style.display).toBe("none");
  });

  it("shows the snap marker on the dragged endpoint only for hoist and vertex snaps", () => {
    const ring = () => layer("main").querySelector("svg > circle")!;
    overlay.render(cells, rulers, "r1", { rulerId: "r1", endpoint: "b", kind: "hoist" }, label);
    expect((ring() as SVGElement).style.display).toBe("inline");
    overlay.render(cells, rulers, "r1", { rulerId: "r1", endpoint: "b", kind: "ground" }, label);
    expect((ring() as SVGElement).style.display).toBe("none");
  });

  it("does not touch the DOM when nothing changed", async () => {
    overlay.render(cells, rulers, "r1", null, label);
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, attributes: true, childList: true, characterData: true });
    overlay.render(cells, rulers, "r1", null, label);
    await Promise.resolve();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it("hides the whole layer outside the measure tool", () => {
    overlay.setVisible(false);
    const root = host.querySelector<HTMLDivElement>('[data-testid="measure-overlay"]')!;
    expect(root.style.display).toBe("none");
    overlay.setVisible(true);
    expect(root.style.display).toBe("block");
  });
});
