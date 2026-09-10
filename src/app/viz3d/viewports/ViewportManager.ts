import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import type {
  CameraPose,
  SlotRect,
  ToolMode,
  SavedView,
  ViewPreset,
  ViewportLayout,
  ViewportSplit,
} from "../types";
import {
  invertOrthoContainHalf,
  perspectiveContainScale,
  resolveOrthoContainHalf,
} from "../cameras/aspect-frustum";
import {
  clampFocalLengthMm,
  DEFAULT_FOCAL_LENGTH_MM,
  focalLengthToFov,
} from "../cameras/focal-length";
import { DEFAULT_VIEW_DISTANCE, isOrthographicViewPreset, resolveViewPose } from "../cameras/ViewPresets";
import { OrbitControlsAdapter, PERSPECTIVE_PANNING_SENSIBILITY, resolveOrthoPanningSensibility } from "../cameras/OrbitControlsAdapter";
import {
  CameraFlyTo,
  DEFAULT_FOCUS_DURATION_MS,
  type FocusFrame,
} from "../cameras/camera-focus";
import type { Vec3 } from "../types";
import {
  clampSplit,
  computeViewportCells,
  DEFAULT_SPLIT,
  findCellIndexAt,
} from "./ViewportLayout";

const LAYOUT_PRESETS: Record<ViewportLayout, ViewPreset[]> = {
  single: ["persp"],
  dual: ["persp", "top"],
  quad: ["top", "front", "side", "persp"],
};

const ORIGIN = { x: 0, y: 0, z: 0 };
const DEFAULT_ORTHO_HALF = DEFAULT_VIEW_DISTANCE * 0.5;
const RADIUS_EPS = 1e-4;

const orbitIndexFor = (presets: ViewPreset[]): number => {
  const index = presets.indexOf("persp");
  return index === -1 ? 0 : index;
};

type VizCamera = FreeCamera | ArcRotateCamera;

const applyPoseToCamera = (camera: VizCamera, preset: ViewPreset): void => {
  const pose = resolveViewPose(preset);
  if (camera instanceof ArcRotateCamera) {
    camera.setPosition(new Vector3(pose.position.x, pose.position.y, pose.position.z));
    camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
    return;
  }
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
  camera.upVector.set(pose.up.x, pose.up.y, pose.up.z);
};

const syncOrthoFrustum = (camera: VizCamera, halfHeight: number, aspect: number): void => {
  const safeHalf = Math.max(0.5, halfHeight);
  const safeAspect = aspect > 0 ? aspect : 1;
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoTop = safeHalf;
  camera.orthoBottom = -safeHalf;
  camera.orthoLeft = -safeHalf * safeAspect;
  camera.orthoRight = safeHalf * safeAspect;
  if (camera instanceof ArcRotateCamera) {
    camera.panningSensibility = resolveOrthoPanningSensibility(safeHalf);
  }
};

const applyPerspective = (camera: VizCamera): void => {
  camera.mode = Camera.PERSPECTIVE_CAMERA;
  if (camera instanceof ArcRotateCamera) {
    camera.panningSensibility = PERSPECTIVE_PANNING_SENSIBILITY;
  }
};

export type PickTarget = { camera: VizCamera; screenRect: SlotRect };

export class ViewportManager {
  private layout: ViewportLayout = "single";
  private split: ViewportSplit = { ...DEFAULT_SPLIT };
  private presets: ViewPreset[] = LAYOUT_PRESETS.single;
  private cameras: VizCamera[] = [];
  private orbitIndex = 0;
  private controls: OrbitControlsAdapter | null = null;
  private flyTo = new CameraFlyTo();
  private mode: ToolMode = "select";
  private focalLengthMm = DEFAULT_FOCAL_LENGTH_MM;
  private activePreset: ViewPreset = "persp";
  /** Reference ortho half-height (zoom), before aspect contain compensation. */
  private orthoHalfHeight = DEFAULT_ORTHO_HALF;
  /** Reference perspective radius (zoom), before aspect contain compensation. */
  private zoomRadius = DEFAULT_VIEW_DISTANCE;
  /** Locked on first valid canvas aspect so nav tab size changes don't reframe. */
  private refAspect: number | null = null;
  /** Skip zoom capture while we write contain-compensated projection. */
  private applyingAspectCompensation = false;
  /** Skip zoom capture while restoring a persisted SavedView (setTarget 会误触发 capture). */
  private applyingSavedView = false;
  /** Aspect used by the last render of the orbit cell (for zoom capture). */
  private lastOrbitAspect: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly onChange: () => void,
  ) {
    this.buildCameras();
    this.rebuildControls();
  }

  getLayout(): ViewportLayout {
    return this.layout;
  }

  getMode(): ToolMode {
    return this.mode;
  }

  getViewPreset(): ViewPreset {
    return this.activePreset;
  }

  isOrthographic(): boolean {
    return this.cameras[this.orbitIndex]?.mode === Camera.ORTHOGRAPHIC_CAMERA;
  }

  getSplit(): ViewportSplit {
    return { ...this.split };
  }

  setLayout(layout: ViewportLayout): void {
    if (layout === this.layout) {
      return;
    }
    this.layout = layout;
    this.presets = LAYOUT_PRESETS[layout];
    this.buildCameras();
    this.rebuildControls();
    this.onChange();
  }

  setSplit(split: ViewportSplit): void {
    this.split = clampSplit(split);
    this.onChange();
  }

  setMode(mode: ToolMode): void {
    this.mode = mode;
    this.controls?.setEnabled(true);
  }

  setOrbitEnabled(enabled: boolean): void {
    this.controls?.setEnabled(enabled);
  }

  setOrbitRotateEnabled(enabled: boolean): void {
    this.controls?.setRotateEnabled(enabled);
  }

  setView(preset: ViewPreset): void {
    // 切换正交视角时保留当前缩放
    this.captureZoomFromCamera();
    this.activePreset = preset;
    const camera = this.cameras[this.orbitIndex];
    applyPoseToCamera(camera, preset);
    this.controls?.setTarget(ORIGIN);
    if (camera instanceof ArcRotateCamera) {
      this.zoomRadius = Math.max(0.1, camera.radius);
      this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    }

    const ortho = isOrthographicViewPreset(preset);
    if (ortho) {
      this.applyOrthoForAspect(camera, this.resolveAspect());
      // 位姿落定后再锁 alpha/beta，避免沿用旧角度限制
      this.controls?.setRotateEnabled(false);
    } else {
      applyPerspective(camera);
      this.applyPerspectiveRadiusForAspect(camera, this.resolveAspect());
      this.controls?.setRotateEnabled(true);
    }
    this.onChange();
  }

  /** 仅切换投影，不改视角位姿（菜单「透视 / 正交」） */
  setOrthographicEnabled(enabled: boolean): void {
    const camera = this.cameras[this.orbitIndex];
    if (!camera) return;
    const aspect = this.resolveAspect();
    if (enabled) {
      this.captureZoomFromCamera();
      this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
      this.applyOrthoForAspect(camera, aspect);
      this.controls?.setRotateEnabled(false);
    } else {
      this.captureZoomFromCamera();
      applyPerspective(camera);
      this.applyPerspectiveRadiusForAspect(camera, aspect);
      this.controls?.setRotateEnabled(true);
      if (isOrthographicViewPreset(this.activePreset)) {
        this.activePreset = "persp";
      }
    }
    this.onChange();
  }

  getPose(): CameraPose {
    const camera = this.cameras[this.orbitIndex];
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: this.controls?.getTarget() ?? { ...ORIGIN },
    };
  }

  applyPose(pose: CameraPose): void {
    const camera = this.cameras[this.orbitIndex];
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    if (camera instanceof ArcRotateCamera) {
      camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
    } else {
      camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
    }
    this.controls?.setTarget(pose.target);
    this.onChange();
  }

  /** 恢复位姿并按预设投影 */
  restorePoseAndPreset(pose: CameraPose, preset: ViewPreset): void {
    this.applyPose(pose);
    this.activePreset = preset;
    const camera = this.cameras[this.orbitIndex];
    this.captureZoomFromCamera();
    const aspect = this.resolveAspect();
    if (isOrthographicViewPreset(preset)) {
      this.applyOrthoForAspect(camera, aspect);
      this.controls?.setRotateEnabled(false);
    } else {
      applyPerspective(camera);
      this.applyPerspectiveRadiusForAspect(camera, aspect);
      this.controls?.setRotateEnabled(true);
    }
    this.onChange();
  }

  getPrimaryCamera(): VizCamera {
    return this.cameras[this.orbitIndex];
  }

  getControls(): OrbitControlsAdapter | null {
    return this.controls;
  }

  setFocalLength(mm: number): void {
    this.focalLengthMm = clampFocalLengthMm(mm);
    const camera = this.cameras[this.orbitIndex];
    camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
    if (camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) {
      this.applyPerspectiveRadiusForAspect(camera, this.resolveAspect());
    }
    this.onChange();
  }

  getFocalLength(): number {
    return this.focalLengthMm;
  }

  /** 仅相机字段；gridSize 由 Viz3DEngine 从 SceneManager 合并 */
  getSavedView(): Omit<SavedView, "gridSize"> {
    this.captureZoomFromCamera();
    const camera = this.cameras[this.orbitIndex];
    const targetVec = this.controls?.getTarget() ?? ORIGIN;
    const target: [number, number, number] = [targetVec.x, targetVec.y, targetVec.z];
    if (camera instanceof ArcRotateCamera) {
      return {
        target,
        alpha: camera.alpha,
        beta: camera.beta,
        zoomRadius: this.zoomRadius,
        orthoHalfHeight: this.orthoHalfHeight,
        preset: this.activePreset,
        focalLengthMm: this.focalLengthMm,
      };
    }
    return {
      target,
      alpha: -Math.PI / 4,
      beta: Math.PI / 3,
      zoomRadius: this.zoomRadius,
      orthoHalfHeight: this.orthoHalfHeight,
      preset: this.activePreset,
      focalLengthMm: this.focalLengthMm,
    };
  }

  applySavedView(view: SavedView): void {
    this.applyingSavedView = true;
    try {
      this.activePreset = view.preset;
      this.focalLengthMm = clampFocalLengthMm(view.focalLengthMm);
      this.zoomRadius = Math.max(0.1, view.zoomRadius);
      this.orthoHalfHeight = Math.max(0.5, view.orthoHalfHeight);
      const camera = this.cameras[this.orbitIndex];
      const target = { x: view.target[0], y: view.target[1], z: view.target[2] };
      // setTarget / controls.setTarget 都会 rebuildAnglesAndRadius，角度与参考半径必须最后写回
      if (camera instanceof ArcRotateCamera) {
        camera.setTarget(new Vector3(target.x, target.y, target.z));
        this.controls?.setTarget(target);
        camera.alpha = view.alpha;
        camera.beta = view.beta;
        // setTarget 的 onChange 可能曾污染 zoomRadius，按落盘值再钉一次
        this.zoomRadius = Math.max(0.1, view.zoomRadius);
        this.orthoHalfHeight = Math.max(0.5, view.orthoHalfHeight);
        camera.radius = this.zoomRadius;
      } else {
        camera.setTarget(new Vector3(target.x, target.y, target.z));
        this.controls?.setTarget(target);
      }
      camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
      const aspect = this.resolveAspect();
      if (isOrthographicViewPreset(view.preset)) {
        this.applyOrthoForAspect(camera, aspect);
        this.controls?.setRotateEnabled(false);
      } else {
        applyPerspective(camera);
        this.applyPerspectiveRadiusForAspect(camera, aspect);
        this.controls?.setRotateEnabled(true);
      }
      this.onChange();
    } finally {
      this.applyingSavedView = false;
    }
  }

  focusOnWorldPoint(center: { x: number; y: number; z: number }, distance: number): void {
    const camera = this.cameras[this.orbitIndex];
    const target = new Vector3(center.x, center.y, center.z);
    const offset = new Vector3(1, 0.8, 1).normalize().scale(Math.max(distance, 4));
    camera.position.copyFrom(target.add(offset));
    if (camera instanceof ArcRotateCamera) {
      camera.setTarget(target);
    } else {
      camera.setTarget(target);
    }
    this.controls?.setTarget({ x: center.x, y: center.y, z: center.z });
    this.zoomRadius = Math.max(0.1, distance);
    this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    const aspect = this.resolveAspect();
    if (this.isOrthographic()) {
      this.applyOrthoForAspect(camera, aspect);
    } else {
      this.applyPerspectiveRadiusForAspect(camera, aspect);
    }
    this.onChange();
  }

  /** 平滑聚焦到指定中心与缩放，保留当前观察方向 */
  focusAnimated(center: Vec3, distance: number, orthoHalfHeight: number): void {
    const camera = this.cameras[this.orbitIndex];
    if (!(camera instanceof ArcRotateCamera)) return;
    const currentTarget = this.controls?.getTarget() ?? { ...ORIGIN };
    const from: FocusFrame = {
      target: { x: currentTarget.x, y: currentTarget.y, z: currentTarget.z },
      distance: Math.max(0.1, this.zoomRadius),
      orthoHalfHeight: Math.max(0.5, this.orthoHalfHeight),
    };
    const to: FocusFrame = {
      target: { x: center.x, y: center.y, z: center.z },
      distance: Math.max(0.1, distance),
      orthoHalfHeight: Math.max(0.5, orthoHalfHeight),
    };
    this.flyTo.start(from, to, DEFAULT_FOCUS_DURATION_MS);
  }

  /** 推进进行中的聚焦动画；无动画时 no-op */
  tick(nowMs: number): void {
    if (!this.flyTo.active) return;
    const sample = this.flyTo.sample(nowMs);
    if (sample) {
      this.applyFocusFrame(sample.frame);
    }
  }

  cancelFocusAnimation(): void {
    this.flyTo.cancel();
  }

  private applyFocusFrame(frame: FocusFrame): void {
    const camera = this.cameras[this.orbitIndex];
    if (!(camera instanceof ArcRotateCamera)) return;
    // cloneAlphaBetaRadius=true：只移 target，不重建 alpha/beta/radius，保留方向
    camera.setTarget(
      new Vector3(frame.target.x, frame.target.y, frame.target.z),
      false,
      false,
      true,
    );
    this.zoomRadius = Math.max(0.1, frame.distance);
    this.orthoHalfHeight = Math.max(0.5, frame.orthoHalfHeight);
    const aspect = this.resolveAspect();
    if (this.isOrthographic()) {
      this.applyOrthoForAspect(camera, aspect);
      camera.radius = Math.max(camera.lowerRadiusLimit ?? 0.1, this.orthoHalfHeight * 2);
    } else {
      this.applyPerspectiveRadiusForAspect(camera, aspect);
    }
  }

  getPickTarget(localX: number, localY: number, slotRect: SlotRect): PickTarget | null {
    const cells = computeViewportCells(
      this.layout,
      { left: 0, top: 0, width: slotRect.width, height: slotRect.height },
      this.split,
    );
    const index = findCellIndexAt(cells, localX, localY);
    if (index === -1) {
      return null;
    }
    const cell = cells[index];
    return {
      camera: this.cameras[index],
      screenRect: {
        left: slotRect.left + cell.left,
        top: slotRect.top + cell.top,
        width: cell.width,
        height: cell.height,
      },
    };
  }

  render(_engine: AbstractEngine, scene: Scene, slotRect: SlotRect): void {
    const cells = computeViewportCells(
      this.layout,
      { left: 0, top: 0, width: slotRect.width, height: slotRect.height },
      this.split,
    );
    const totalWidth = slotRect.width;
    const totalHeight = slotRect.height;

    if (totalWidth <= 0 || totalHeight <= 0) {
      return;
    }

    const previousAutoClear = scene.autoClear;
    const previousAutoClearDepth = scene.autoClearDepthAndStencil;

    cells.forEach((cell, index) => {
      if (cell.width <= 0 || cell.height <= 0) {
        return;
      }
      const camera = this.cameras[index];
      const aspect = cell.height > 0 ? cell.width / cell.height : 1;
      if (index === this.orbitIndex) {
        this.ensureRefAspect(aspect);
        this.lastOrbitAspect = aspect;
      }
      camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
      if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
        const refHalf =
          index === this.orbitIndex ? this.orthoHalfHeight : DEFAULT_ORTHO_HALF;
        const refAspect = this.refAspect ?? aspect;
        const half = resolveOrthoContainHalf(refHalf, aspect, refAspect);
        this.withAspectCompensation(() => syncOrthoFrustum(camera, half, aspect));
      } else if (index === this.orbitIndex) {
        this.applyPerspectiveRadiusForAspect(camera, aspect);
      }
      const glY = totalHeight - (cell.top + cell.height);
      camera.viewport = new Viewport(
        cell.left / totalWidth,
        glY / totalHeight,
        cell.width / totalWidth,
        cell.height / totalHeight,
      );
      scene.activeCamera = camera;
      scene.autoClear = index === 0;
      scene.autoClearDepthAndStencil = index === 0;
      scene.render();
    });

    scene.autoClear = previousAutoClear;
    scene.autoClearDepthAndStencil = previousAutoClearDepth;
  }

  dispose(): void {
    this.controls?.dispose();
    this.controls = null;
    for (const camera of this.cameras) {
      camera.dispose();
    }
    this.cameras = [];
  }

  private resolveAspect(): number {
    const engine = this.scene.getEngine();
    const h = engine.getRenderHeight();
    return h > 0 ? engine.getRenderWidth() / h : 1;
  }

  private ensureRefAspect(aspect: number): void {
    if (this.refAspect === null && aspect > 0) {
      this.refAspect = aspect;
    }
  }

  private refAspectOr(aspect: number): number {
    this.ensureRefAspect(aspect);
    return this.refAspect ?? aspect;
  }

  private withAspectCompensation(fn: () => void): void {
    this.applyingAspectCompensation = true;
    try {
      fn();
    } finally {
      this.applyingAspectCompensation = false;
    }
  }

  private applyOrthoForAspect(camera: VizCamera, aspect: number): void {
    const refAspect = this.refAspectOr(aspect);
    const half = resolveOrthoContainHalf(this.orthoHalfHeight, aspect, refAspect);
    this.withAspectCompensation(() => syncOrthoFrustum(camera, half, aspect));
  }

  private applyPerspectiveRadiusForAspect(camera: VizCamera, aspect: number): void {
    if (!(camera instanceof ArcRotateCamera)) {
      return;
    }
    if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
      return;
    }
    const refAspect = this.refAspectOr(aspect);
    const scale = perspectiveContainScale(aspect, refAspect, camera.fov);
    const target = Math.max(camera.lowerRadiusLimit ?? 0.1, this.zoomRadius * scale);
    if (Math.abs(camera.radius - target) > RADIUS_EPS) {
      this.withAspectCompensation(() => {
        camera.radius = target;
      });
    }
  }

  /** Recover reference zoom from the live camera (undo contain compensation). */
  private captureZoomFromCamera(): void {
    if (this.applyingAspectCompensation || this.applyingSavedView) {
      return;
    }
    const camera = this.cameras[this.orbitIndex];
    if (!camera) return;
    const aspect = this.lastOrbitAspect ?? this.resolveAspect();
    const refAspect = this.refAspectOr(aspect);
    if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
      const applied = Math.max(0.5, Math.abs(camera.orthoTop || DEFAULT_ORTHO_HALF));
      this.orthoHalfHeight = invertOrthoContainHalf(applied, aspect, refAspect);
      this.zoomRadius = Math.max(0.1, this.orthoHalfHeight * 2);
      return;
    }
    if (camera instanceof ArcRotateCamera) {
      const scale = perspectiveContainScale(aspect, refAspect, camera.fov);
      this.zoomRadius = Math.max(0.1, camera.radius / (scale > 0 ? scale : 1));
      this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    }
  }

  private buildCameras(): void {
    for (const camera of this.cameras) {
      camera.dispose();
    }
    this.orbitIndex = orbitIndexFor(this.presets);
    this.cameras = this.presets.map((preset, index) => {
      if (index === this.orbitIndex) {
        const camera = new ArcRotateCamera(
          `viz3d-orbit-${preset}`,
          -Math.PI / 4,
          Math.PI / 3,
          10,
          Vector3.Zero(),
          this.scene,
        );
        applyPoseToCamera(camera, preset);
        camera.minZ = 0.1;
        camera.maxZ = 1000;
        if (camera instanceof ArcRotateCamera) {
          this.zoomRadius = Math.max(0.1, camera.radius);
          this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
        }
        if (isOrthographicViewPreset(preset)) {
          syncOrthoFrustum(camera, this.orthoHalfHeight, 1);
        } else {
          applyPerspective(camera);
        }
        return camera;
      }
      const camera = new FreeCamera(`viz3d-view-${preset}`, Vector3.Zero(), this.scene);
      applyPoseToCamera(camera, preset);
      camera.minZ = 0.1;
      camera.maxZ = 1000;
      if (isOrthographicViewPreset(preset)) {
        syncOrthoFrustum(camera, DEFAULT_ORTHO_HALF, 1);
      } else {
        applyPerspective(camera);
      }
      return camera;
    });
    this.activePreset = this.presets[this.orbitIndex] ?? "persp";
  }

  private rebuildControls(): void {
    this.controls?.dispose();
    this.controls = null;
    const orbitCamera = this.cameras[this.orbitIndex];
    if (!(orbitCamera instanceof ArcRotateCamera)) {
      return;
    }
    this.controls = new OrbitControlsAdapter(orbitCamera, () => {
      if (!this.applyingAspectCompensation && !this.applyingSavedView) {
        this.captureZoomFromCamera();
      }
      this.onChange();
    });
    this.controls.setEnabled(true);
    this.controls.setTarget(ORIGIN);
    this.controls.setRotateEnabled(!isOrthographicViewPreset(this.activePreset));
  }
}
