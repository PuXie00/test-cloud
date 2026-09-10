import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposable } from "../types";
import { configureUnlitTexturedMaterial } from "../materials/pbr-material";
import { resolveHoistLabelSize } from "./hoist-point-label-size";

const DPR = typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 2;

const UNBOUND_BG = "#1d2326";
const UNBOUND_FG = "#dee3e6";
const BOUND_BG = "#4cd6fb";
const BOUND_FG = "#003642";
const SELECTED_BORDER = "#4cd6fb";

type LabelStyle = { bound: boolean; selected: boolean };

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

export class HoistPointLabel implements Disposable {
  readonly plane: Mesh;
  private readonly scene: Scene;
  private readonly texture: DynamicTexture;
  private readonly material: StandardMaterial;
  private text = "1";
  private style: LabelStyle = { bound: false, selected: false };
  private baseWidth = 1;
  private baseHeight = 1;
  private boundCamera: Camera | null = null;
  private activeCameraObserver: Observer<Scene> | null = null;
  private viewMatrixObserver: Observer<Camera> | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    this.texture = new DynamicTexture("viz3d-hoist-label", { width: 256, height: 256 }, scene, false);
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial("viz3d-hoist-label-mat", scene);
    this.material.diffuseTexture = this.texture;
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    configureUnlitTexturedMaterial(this.material);
    this.material.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane("viz3d-hoist-label-plane", { size: 1 }, scene);
    this.plane.material = this.material;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.setEnabled(false);
    this.redraw();

    this.activeCameraObserver = scene.onActiveCameraChanged.add(() => this.rebindCamera());
    this.rebindCamera();
  }

  setText(text: string): void {
    this.plane.setEnabled(true);
    if (this.text === text) return;
    this.text = text;
    this.redraw();
  }

  setOffsetY(offsetY: number): void {
    this.plane.position.y = offsetY;
    this.syncSize();
  }

  setSpriteSize(width: number, height: number): void {
    this.baseWidth = width;
    this.baseHeight = height;
    this.syncSize();
  }

  setAppearance(bound: boolean, selected: boolean): void {
    this.style = { bound, selected };
    this.redraw();
  }

  dispose(): void {
    if (this.viewMatrixObserver && this.boundCamera) {
      this.boundCamera.onViewMatrixChangedObservable.remove(this.viewMatrixObserver);
      this.viewMatrixObserver = null;
    }
    if (this.activeCameraObserver) {
      this.scene.onActiveCameraChanged.remove(this.activeCameraObserver);
      this.activeCameraObserver = null;
    }
    this.boundCamera = null;
    this.plane.dispose(false, true);
    this.texture.dispose();
    this.material.dispose();
  }

  private rebindCamera(): void {
    const camera = this.scene.activeCamera ?? null;
    if (camera === this.boundCamera) {
      this.syncSize();
      return;
    }
    if (this.viewMatrixObserver && this.boundCamera) {
      this.boundCamera.onViewMatrixChangedObservable.remove(this.viewMatrixObserver);
      this.viewMatrixObserver = null;
    }
    this.boundCamera = camera;
    if (camera) {
      this.viewMatrixObserver = camera.onViewMatrixChangedObservable.add(() => this.syncSize());
    }
    this.syncSize();
  }

  private syncSize(): void {
    const camera = this.boundCamera ?? this.scene.activeCamera;
    const baseSize = Math.max(this.baseWidth, this.baseHeight);
    if (!camera) {
      this.applyScaling(baseSize);
      return;
    }

    const world = this.plane.getAbsolutePosition();
    const distance = Vector3.Distance(camera.globalPosition, world);
    const size = resolveHoistLabelSize({
      distance,
      fov: camera.fov,
      orthographic: camera.mode === Camera.ORTHOGRAPHIC_CAMERA,
      baseSize,
    });
    this.applyScaling(size);
  }

  private applyScaling(size: number): void {
    const baseSize = Math.max(this.baseWidth, this.baseHeight);
    const factor = baseSize > 0 ? size / baseSize : 1;
    this.plane.scaling.set(this.baseWidth * factor, this.baseHeight * factor, 1);
  }

  private redraw(): void {
    const text = this.text;
    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    const DPR2 = DPR * 2;
    const ASPECT = 1 / 1;
    const baseHeight = 256 * DPR2;
    const canvasH = Math.round(baseHeight);
    const canvasW = Math.round(baseHeight * ASPECT);

    this.texture.scaleTo(canvasW, canvasH);
    ctx.clearRect(0, 0, canvasW, canvasH);

    const border = this.style.selected ? 4 * DPR2 : 0;
    const margin = 6 * DPR;
    const badgeH = canvasH - margin * 2;
    const badgeW = badgeH * ASPECT;
    const badgeX = (canvasW - badgeW) / 2;
    const badgeY = margin;

    if (this.style.selected) {
      ctx.fillStyle = SELECTED_BORDER;
      drawRoundedRect(
        ctx,
        badgeX - border,
        badgeY - border,
        badgeW + border * 2,
        badgeH + border * 2,
        14 * DPR,
      );
      ctx.fill();
    }

    const bg = this.style.bound ? BOUND_BG : UNBOUND_BG;
    const fg = this.style.bound ? BOUND_FG : UNBOUND_FG;

    ctx.fillStyle = bg;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12 * DPR);
    ctx.fill();

    ctx.font = `700 ${Math.round(badgeH * 0.62)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, canvasW / 2, canvasH / 2 + 1 * DPR);

    this.texture.update();
  }
}
