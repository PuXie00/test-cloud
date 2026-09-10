import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import {
  createGroundGrid,
  DEFAULT_GRID_CELL_M,
  DEFAULT_GRID_SIZE_M,
  normalizeGridSizeM,
} from "../helpers/grid-config";
import { DomLabelRenderer } from "../labels/DomLabelRenderer";
import type { Disposable, GridSizeM, SlotRect, Viz3DColorMap } from "../types";
import { hexToColor3 } from "../babylon/utils";
import { applySceneEnvironment, createSceneEnvironment, type SceneEnvironmentHandle } from "./scene-environment";

const TOP_HEMI_INTENSITY = 0.5;
const BOTTOM_HEMI_INTENSITY = 0.5;
const KEY_LIGHT_INTENSITY = 0.65;
const FILL_LIGHT_INTENSITY = 0.12;

export class SceneManager implements Disposable {
  readonly scene: Scene;
  private grid: Mesh;
  private gridSize: GridSizeM = DEFAULT_GRID_SIZE_M;
  private colors: Viz3DColorMap;
  private readonly labelRenderer = new DomLabelRenderer();
  private topHemi: HemisphericLight;
  private bottomHemi: HemisphericLight;
  private keyLight: DirectionalLight;
  private fillLight: DirectionalLight;
  private sceneEnvironment: SceneEnvironmentHandle | null = null;

  constructor(engine: AbstractEngine, colors: Viz3DColorMap) {
    this.scene = new Scene(engine);
    this.colors = colors;
    this.grid = createGroundGrid({
      size: this.gridSize,
      cell: DEFAULT_GRID_CELL_M,
      colors,
      scene: this.scene,
    });
    this.scene.clearColor = hexToColor3(colors.canvas).toColor4(1);

    const hemi = createHemisphereLights(this.scene, colors);
    this.topHemi = hemi.top;
    this.bottomHemi = hemi.bottom;

    this.keyLight = new DirectionalLight("viz3d-key", new Vector3(4, -8, 6), this.scene);
    this.keyLight.intensity = KEY_LIGHT_INTENSITY;

    this.fillLight = new DirectionalLight("viz3d-fill", new Vector3(-3, -2, -4), this.scene);
    this.fillLight.intensity = FILL_LIGHT_INTENSITY;
  }

  attachEnvironment(): void {
    this.sceneEnvironment?.dispose();
    this.sceneEnvironment = createSceneEnvironment(this.scene);
    applySceneEnvironment(this.scene);
  }

  setGridVisible(visible: boolean): void {
    this.grid.setEnabled(visible);
  }

  getGridSize(): GridSizeM {
    return this.gridSize;
  }

  setGridSize(size: GridSizeM): void {
    const next = normalizeGridSizeM(size);
    if (next === this.gridSize) return;
    this.gridSize = next;
    this.rebuildGrid();
  }

  getLabelRenderer(): DomLabelRenderer {
    return this.labelRenderer;
  }

  ensureLabelRenderer(width: number, height: number): void {
    void width;
    void height;
  }

  renderLabels(camera: Camera, slotRect: SlotRect, host: HTMLElement): void {
    this.labelRenderer.render(this.scene, camera, slotRect, host);
  }

  applyColors(colors: Viz3DColorMap): void {
    this.colors = colors;
    this.scene.clearColor = hexToColor3(colors.canvas).toColor4(1);
    this.rebuildGrid();
  }

  dispose(): void {
    this.sceneEnvironment?.dispose();
    this.sceneEnvironment = null;
    this.scene.environmentTexture = null;
    this.grid.dispose(false, true);
    this.labelRenderer.dispose();
    this.scene.dispose();
  }

  private rebuildGrid(): void {
    const wasEnabled = this.grid.isEnabled();
    const nextGrid = createGroundGrid({
      size: this.gridSize,
      cell: DEFAULT_GRID_CELL_M,
      colors: this.colors,
      scene: this.scene,
    });
    nextGrid.setEnabled(wasEnabled);
    this.grid.dispose(false, true);
    this.grid = nextGrid;
  }
}

const createHemisphereLights = (scene: Scene, colors: Viz3DColorMap) => {
  const top = new HemisphericLight("viz3d-hemi-top", Vector3.Up(), scene);
  top.intensity = TOP_HEMI_INTENSITY;

  const bottom = new HemisphericLight("viz3d-hemi-bottom", Vector3.Down(), scene);
  bottom.intensity = BOTTOM_HEMI_INTENSITY;

  return { top, bottom };
};
