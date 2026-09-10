import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Vec3 } from "../types";
import { applyViewportCameraBindings, type ViewportCameraMapEntry } from "./viewport-camera-bindings";

const ORTHO_HALF_MIN = 0.5;
const ORTHO_HALF_MAX = 200;
/** Lower = more pan per pixel. Babylon default is 1000. */
export const PERSPECTIVE_PANNING_SENSIBILITY = 400;
export const resolveOrthoPanningSensibility = (halfHeight: number): number =>
  Math.max(80, 1600 / Math.max(halfHeight, ORTHO_HALF_MIN));

export class OrbitControlsAdapter {
  private readonly camera: ArcRotateCamera;
  private readonly onChange: () => void;
  private viewMatrixObserver: Observer<Camera> | null = null;
  private enabled = true;
  private rotateEnabled = true;
  private attached = false;

  constructor(camera: ArcRotateCamera, onChange: () => void) {
    this.camera = camera;
    this.onChange = onChange;
    this.camera.panningSensibility = PERSPECTIVE_PANNING_SENSIBILITY;
    this.camera.useNaturalPinchZoom = false;
    this.camera.wheelPrecision = 120;
    this.removeMouseWheelInput();
    this.attach();
    this.viewMatrixObserver = this.camera.onViewMatrixChangedObservable.add(onChange);
  }

  applyWheelZoom(deltaY: number): void {
    if (deltaY === 0) {
      return;
    }
    const factor = deltaY < 0 ? 0.95 : 1.05;
    if (this.camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
      const currentHalf = Math.abs(this.camera.orthoTop || this.camera.radius * 0.5 || 7);
      const nextHalf = Math.min(ORTHO_HALF_MAX, Math.max(ORTHO_HALF_MIN, currentHalf * factor));
      const aspect = this.resolveAspect();
      this.camera.orthoTop = nextHalf;
      this.camera.orthoBottom = -nextHalf;
      this.camera.orthoLeft = -nextHalf * aspect;
      this.camera.orthoRight = nextHalf * aspect;
      // 保持 radius 同步，便于切回透视时缩放连贯
      this.camera.radius = Math.max(this.camera.lowerRadiusLimit ?? 0.1, nextHalf * 2);
      this.camera.panningSensibility = resolveOrthoPanningSensibility(nextHalf);
      this.onChange();
      return;
    }
    this.camera.radius = Math.max(this.camera.lowerRadiusLimit ?? 0.1, this.camera.radius * factor);
    this.onChange();
  }

  private resolveAspect(): number {
    const halfH = Math.abs(this.camera.orthoTop || 0);
    const halfW = Math.abs(this.camera.orthoLeft || 0);
    if (halfH > 0 && halfW > 0) {
      return halfW / halfH;
    }
    const engine = this.camera.getEngine();
    const h = engine.getRenderHeight();
    return h > 0 ? engine.getRenderWidth() / h : 1;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      this.attach();
      return;
    }
    this.detach();
  }

  setRotateEnabled(enabled: boolean): void {
    this.rotateEnabled = enabled;
    this.applyRotateEnabled();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setTarget(target: Vec3): void {
    this.camera.setTarget(new Vector3(target.x, target.y, target.z));
    // setTarget 会改写 alpha/beta，禁用旋转时需重新锁死
    if (!this.rotateEnabled) {
      this.lockOrbitAngles();
    }
    this.onChange();
  }

  getTarget(): Vec3 {
    const t = this.camera.target;
    return { x: t.x, y: t.y, z: t.z };
  }

  update(): void {
    this.onChange();
  }

  dispose(): void {
    this.detach();
    if (this.viewMatrixObserver) {
      this.camera.onViewMatrixChangedObservable.remove(this.viewMatrixObserver);
      this.viewMatrixObserver = null;
    }
  }

  private attach(): void {
    if (this.attached || !this.enabled) {
      return;
    }
    const canvas = this.camera.getEngine().getRenderingCanvas();
    if (canvas) {
      canvas.style.touchAction = "none";
    }
    this.camera.attachControl(null, false, true);
    this.configurePointerBindings();
    this.attached = true;
    this.applyRotateEnabled();
  }

  private detach(): void {
    if (!this.attached) {
      return;
    }
    this.camera.detachControl();
    this.attached = false;
  }

  private applyRotateEnabled(): void {
    if (!this.rotateEnabled) {
      this.lockOrbitAngles();
    } else {
      this.unlockOrbitAngles();
    }

    const pointers = this.camera.inputs.attached.pointers as
      | { angularSensibilityX?: number; angularSensibilityY?: number }
      | undefined;
    if (!pointers) {
      return;
    }
    // 正交/禁用旋转：灵敏度拉满抑制拖转；真正约束靠 alpha/beta limit
    const sens = this.enabled && this.rotateEnabled ? 1000 : Number.MAX_VALUE;
    pointers.angularSensibilityX = sens;
    pointers.angularSensibilityY = sens;
  }

  /** 硬锁当前 alpha/beta，禁止轨道旋转（正交视角） */
  private lockOrbitAngles(): void {
    const { alpha, beta } = this.camera;
    this.camera.lowerAlphaLimit = alpha;
    this.camera.upperAlphaLimit = alpha;
    this.camera.lowerBetaLimit = beta;
    this.camera.upperBetaLimit = beta;
    this.camera.inertialAlphaOffset = 0;
    this.camera.inertialBetaOffset = 0;
  }

  private unlockOrbitAngles(): void {
    this.camera.lowerAlphaLimit = null;
    this.camera.upperAlphaLimit = null;
    this.camera.lowerBetaLimit = 0.01;
    this.camera.upperBetaLimit = Math.PI;
  }

  /** 滚轮由 ViewportSlot 自定义处理，须用 inputs.remove 而非赋 false */
  private removeMouseWheelInput(): void {
    const wheel = this.camera.inputs.attached.mousewheel;
    if (wheel) {
      this.camera.inputs.remove(wheel);
    }
  }

  /**
   * 中键平移；Alt+中键旋转；去掉左键旋转、右键平移、Ctrl+左键平移。
   * 不使用 getEntry 空条件（会当通配符命中第一条）。
   */
  private configurePointerBindings(): void {
    const movement = (
      this.camera as ArcRotateCamera & {
        movement?: { input: { inputMap: ViewportCameraMapEntry[] } };
      }
    ).movement;
    if (!movement?.input) {
      return;
    }
    applyViewportCameraBindings(movement.input.inputMap);
  }
}

export type OrbitCamera = ArcRotateCamera;
