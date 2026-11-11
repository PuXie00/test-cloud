import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { CameraPose, SavedCameraView, Vec3, ViewPreset, ViewportCellId } from "../types";
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
import {
  OrbitControlsAdapter,
  PERSPECTIVE_PANNING_SENSIBILITY,
  resolveOrthoPanningSensibility,
} from "../cameras/OrbitControlsAdapter";
import { applyCameraFollow } from "../cameras/CameraFollow";
import { CameraFlyTo, DEFAULT_FOCUS_DURATION_MS, type FocusFrame } from "../cameras/camera-focus";

const ORIGIN = { x: 0, y: 0, z: 0 };
const DEFAULT_ORTHO_HALF = DEFAULT_VIEW_DISTANCE * 0.5;
const RADIUS_EPS = 1e-4;

const applyPoseToCamera = (camera: ArcRotateCamera, preset: ViewPreset): void => {
  const pose = resolveViewPose(preset);
  camera.setPosition(new Vector3(pose.position.x, pose.position.y, pose.position.z));
  camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
};

const syncOrthoFrustum = (camera: ArcRotateCamera, halfHeight: number, aspect: number): void => {
  const safeHalf = Math.max(0.5, halfHeight);
  const safeAspect = aspect > 0 ? aspect : 1;
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoTop = safeHalf;
  camera.orthoBottom = -safeHalf;
  camera.orthoLeft = -safeHalf * safeAspect;
  camera.orthoRight = safeHalf * safeAspect;
  camera.panningSensibility = resolveOrthoPanningSensibility(safeHalf);
};

const applyPerspective = (camera: ArcRotateCamera): void => {
  camera.mode = Camera.PERSPECTIVE_CAMERA;
  camera.panningSensibility = PERSPECTIVE_PANNING_SENSIBILITY;
};

/**
 * 一格视口：自己的相机、视角、透视 / 正交、缩放、焦距、跟随。
 * 正交时锁旋转（跟随时也锁）；轨道输入只在这一格是当前格时挂到画布上。
 */
export class ViewportCell {
  readonly camera: ArcRotateCamera;
  private readonly controls: OrbitControlsAdapter;
  private readonly flyTo = new CameraFlyTo();
  private preset: ViewPreset;
  private focalLengthMm = DEFAULT_FOCAL_LENGTH_MM;
  /** Reference ortho half-height (zoom), before aspect contain compensation. */
  private orthoHalfHeight = DEFAULT_ORTHO_HALF;
  /** Reference perspective radius (zoom), before aspect contain compensation. */
  private zoomRadius = DEFAULT_VIEW_DISTANCE;
  /** Locked on first valid cell aspect so later size changes don't reframe. */
  private refAspect: number | null = null;
  /** Skip zoom capture while we write contain-compensated projection. */
  private applyingAspectCompensation = false;
  /** Skip zoom capture while restoring a persisted view (setTarget 会误触发 capture). */
  private applyingSavedView = false;
  /** Aspect used by the last render of this cell (for zoom capture). */
  private lastAspect: number | null = null;
  private followTarget: string | null = null;
  private active = false;
  private orbitEnabled = true;

  constructor(
    scene: Scene,
    readonly id: ViewportCellId,
    preset: ViewPreset,
    private readonly onViewChange: () => void = () => {},
  ) {
    this.preset = preset;
    this.camera = new ArcRotateCamera(
      `viz3d-cell-${id}`,
      -Math.PI / 4,
      Math.PI / 3,
      DEFAULT_VIEW_DISTANCE,
      Vector3.Zero(),
      scene,
    );
    applyPoseToCamera(this.camera, preset);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1000;
    this.camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
    this.zoomRadius = Math.max(0.1, this.camera.radius);
    this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    if (isOrthographicViewPreset(preset)) {
      syncOrthoFrustum(this.camera, this.orthoHalfHeight, 1);
    } else {
      applyPerspective(this.camera);
    }
    this.controls = new OrbitControlsAdapter(
      this.camera,
      () => {
        if (!this.applyingAspectCompensation && !this.applyingSavedView) {
          this.captureZoomFromCamera();
        }
        this.onViewChange();
      },
      false,
    );
    this.controls.setTarget(ORIGIN);
    this.syncRotateLock();
  }

  getPreset(): ViewPreset {
    return this.preset;
  }

  isOrthographic(): boolean {
    return this.camera.mode === Camera.ORTHOGRAPHIC_CAMERA;
  }

  getFollowTarget(): string | null {
    return this.followTarget;
  }

  isActive(): boolean {
    return this.active;
  }

  /** 当前格才挂轨道输入，其他格不响应画布上的拖动 */
  setActive(active: boolean): void {
    this.active = active;
    this.syncAttachment();
  }

  /** 菜单打开等场合临时停掉轨道输入 */
  setOrbitEnabled(enabled: boolean): void {
    this.orbitEnabled = enabled;
    this.syncAttachment();
  }

  setFollowTarget(id: string | null): void {
    this.followTarget = id;
    this.syncRotateLock();
  }

  /** 跟随：保持相机相对目标的偏移，把目标移到物体中心 */
  applyFollow(center: Vec3): void {
    applyCameraFollow(this.camera, this.controls, center);
  }

  setView(preset: ViewPreset): void {
    this.captureZoomFromCamera();
    this.preset = preset;
    // 先解锁角度：正交锁住的 alpha / beta 会把新视角夹回旧视角（顶 → 前切不过去）
    this.controls.setRotateEnabled(true);
    applyPoseToCamera(this.camera, preset);
    this.controls.setTarget(ORIGIN);
    this.zoomRadius = Math.max(0.1, this.camera.radius);
    this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    if (isOrthographicViewPreset(preset)) {
      this.applyOrthoForAspect(this.resolveAspect());
    } else {
      applyPerspective(this.camera);
      this.applyPerspectiveRadiusForAspect(this.resolveAspect());
    }
    // 位姿落定后再锁 alpha/beta，避免沿用旧角度限制
    this.syncRotateLock();
  }

  /** 仅切换投影，不改视角位姿（「透视 / 正交」） */
  setOrthographicEnabled(enabled: boolean): void {
    const aspect = this.resolveAspect();
    this.captureZoomFromCamera();
    if (enabled) {
      this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
      this.applyOrthoForAspect(aspect);
    } else {
      applyPerspective(this.camera);
      this.applyPerspectiveRadiusForAspect(aspect);
      if (isOrthographicViewPreset(this.preset)) {
        this.preset = "persp";
      }
    }
    this.syncRotateLock();
  }

  getPose(): CameraPose {
    const { position } = this.camera;
    return {
      position: { x: position.x, y: position.y, z: position.z },
      target: this.controls.getTarget(),
    };
  }

  applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
    this.controls.setTarget(pose.target);
  }

  setFocalLength(mm: number): void {
    this.focalLengthMm = clampFocalLengthMm(mm);
    this.camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
    if (!this.isOrthographic()) {
      this.applyPerspectiveRadiusForAspect(this.resolveAspect());
    }
  }

  getFocalLength(): number {
    return this.focalLengthMm;
  }

  getSavedView(): SavedCameraView {
    this.captureZoomFromCamera();
    const target = this.controls.getTarget();
    return {
      target: [target.x, target.y, target.z],
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      zoomRadius: this.zoomRadius,
      orthoHalfHeight: this.orthoHalfHeight,
      preset: this.preset,
      focalLengthMm: this.focalLengthMm,
    };
  }

  applySavedView(view: SavedCameraView): void {
    this.applyingSavedView = true;
    try {
      this.flyTo.cancel();
      this.preset = view.preset;
      this.focalLengthMm = clampFocalLengthMm(view.focalLengthMm);
      const target = { x: view.target[0], y: view.target[1], z: view.target[2] };
      // setTarget / controls.setTarget 都会 rebuildAnglesAndRadius，角度与参考半径必须最后写回；
      // 先解锁角度，否则正交格的旧锁会把新角度夹回去
      this.controls.setRotateEnabled(true);
      this.camera.setTarget(new Vector3(target.x, target.y, target.z));
      this.controls.setTarget(target);
      this.camera.alpha = view.alpha;
      this.camera.beta = view.beta;
      this.zoomRadius = Math.max(0.1, view.zoomRadius);
      this.orthoHalfHeight = Math.max(0.5, view.orthoHalfHeight);
      this.camera.radius = this.zoomRadius;
      this.camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
      const aspect = this.resolveAspect();
      if (isOrthographicViewPreset(view.preset)) {
        this.applyOrthoForAspect(aspect);
      } else {
        applyPerspective(this.camera);
        this.applyPerspectiveRadiusForAspect(aspect);
      }
      this.syncRotateLock();
    } finally {
      this.applyingSavedView = false;
    }
  }

  focusOnWorldPoint(center: Vec3, distance: number): void {
    const target = new Vector3(center.x, center.y, center.z);
    const offset = new Vector3(1, 0.8, 1).normalize().scale(Math.max(distance, 4));
    this.camera.position.copyFrom(target.add(offset));
    this.camera.setTarget(target);
    this.controls.setTarget(center);
    this.zoomRadius = Math.max(0.1, distance);
    this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
    const aspect = this.resolveAspect();
    if (this.isOrthographic()) {
      this.applyOrthoForAspect(aspect);
    } else {
      this.applyPerspectiveRadiusForAspect(aspect);
    }
  }

  /** 平滑聚焦到指定中心与缩放，保留当前观察方向 */
  focusAnimated(center: Vec3, distance: number, orthoHalfHeight: number): void {
    const currentTarget = this.controls.getTarget();
    const from: FocusFrame = {
      target: currentTarget,
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

  applyWheelZoom(deltaY: number): void {
    this.flyTo.cancel();
    this.controls.applyWheelZoom(deltaY);
  }

  /** 每帧渲染前按本格宽高比更新投影（正交半高 / 透视半径的 contain 补偿） */
  prepareRender(aspect: number): void {
    this.ensureRefAspect(aspect);
    this.lastAspect = aspect;
    this.camera.fov = (focalLengthToFov(this.focalLengthMm) * Math.PI) / 180;
    if (this.isOrthographic()) {
      const half = resolveOrthoContainHalf(this.orthoHalfHeight, aspect, this.refAspect ?? aspect);
      this.withAspectCompensation(() => syncOrthoFrustum(this.camera, half, aspect));
    } else {
      this.applyPerspectiveRadiusForAspect(aspect);
    }
  }

  dispose(): void {
    this.flyTo.cancel();
    this.controls.dispose();
    this.camera.dispose();
  }

  private syncAttachment(): void {
    this.controls.setEnabled(this.active && this.orbitEnabled);
    this.syncRotateLock();
  }

  /** 正交锁旋转；跟随时也锁（每帧改目标，转起来会打架） */
  private syncRotateLock(): void {
    this.controls.setRotateEnabled(!this.isOrthographic() && this.followTarget == null);
  }

  private applyFocusFrame(frame: FocusFrame): void {
    // cloneAlphaBetaRadius=true：只移 target，不重建 alpha/beta/radius，保留方向
    this.camera.setTarget(
      new Vector3(frame.target.x, frame.target.y, frame.target.z),
      false,
      false,
      true,
    );
    this.zoomRadius = Math.max(0.1, frame.distance);
    this.orthoHalfHeight = Math.max(0.5, frame.orthoHalfHeight);
    const aspect = this.resolveAspect();
    if (this.isOrthographic()) {
      this.applyOrthoForAspect(aspect);
      this.camera.radius = Math.max(this.camera.lowerRadiusLimit ?? 0.1, this.orthoHalfHeight * 2);
    } else {
      this.applyPerspectiveRadiusForAspect(aspect);
    }
  }

  private resolveAspect(): number {
    if (this.lastAspect !== null && this.lastAspect > 0) {
      return this.lastAspect;
    }
    const engine = this.camera.getEngine();
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

  private applyOrthoForAspect(aspect: number): void {
    const half = resolveOrthoContainHalf(this.orthoHalfHeight, aspect, this.refAspectOr(aspect));
    this.withAspectCompensation(() => syncOrthoFrustum(this.camera, half, aspect));
  }

  private applyPerspectiveRadiusForAspect(aspect: number): void {
    if (this.isOrthographic()) {
      return;
    }
    const scale = perspectiveContainScale(aspect, this.refAspectOr(aspect), this.camera.fov);
    const target = Math.max(this.camera.lowerRadiusLimit ?? 0.1, this.zoomRadius * scale);
    if (Math.abs(this.camera.radius - target) > RADIUS_EPS) {
      this.withAspectCompensation(() => {
        this.camera.radius = target;
      });
    }
  }

  /** Recover reference zoom from the live camera (undo contain compensation). */
  private captureZoomFromCamera(): void {
    if (this.applyingAspectCompensation || this.applyingSavedView) {
      return;
    }
    const aspect = this.lastAspect ?? this.resolveAspect();
    const refAspect = this.refAspectOr(aspect);
    if (this.isOrthographic()) {
      const applied = Math.max(0.5, Math.abs(this.camera.orthoTop || DEFAULT_ORTHO_HALF));
      this.orthoHalfHeight = invertOrthoContainHalf(applied, aspect, refAspect);
      this.zoomRadius = Math.max(0.1, this.orthoHalfHeight * 2);
      return;
    }
    const scale = perspectiveContainScale(aspect, refAspect, this.camera.fov);
    this.zoomRadius = Math.max(0.1, this.camera.radius / (scale > 0 ? scale : 1));
    this.orthoHalfHeight = Math.max(0.5, this.zoomRadius * 0.5);
  }
}
