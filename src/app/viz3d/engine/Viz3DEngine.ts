import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Scene } from "@babylonjs/core/scene";
import { CreateScreenshotUsingRenderTargetAsync } from "@babylonjs/core/Misc/screenshotTools";
import { Emitter } from "../events";
import type { DisplayLengthUnit } from "@/app/project/display-length-units";
import type {
  AlignAxis,
  AlignMode,
  BoundingBoxKind,
  CameraPose,
  Disposable,
  DriveUnitLabelFields,
  LoadModelOptions,
  MeasurePayload,
  ModelLoadedPayload,
  PivotChangePayload,
  RecordingOptions,
  RecordingStatePayload,
  SceneObjectConfig,
  SceneObjectStatus,
  ScreenRect,
  PickTarget,
  SelectionMode,
  SlotRect,
  TelemetrySnapshotInput,
  ToolMode,
  TransformEndPayload,
  TransformMode,
  Vec3,
  GridSizeM,
  SavedView,
  ViewPreset,
  ViewportLayout,
  ViewportSplit,
  VirtualAxisValues,
  Viz3DColorMap,
  Viz3DOptions,
} from "../types";
import { DEFAULT_GRID_SIZE_M, normalizeGridSizeM } from "../helpers/grid-config";
import { applyCameraFollow } from "../cameras/CameraFollow";
import { mergeFocusBounds, resolveFocusFit } from "../cameras/camera-focus";
import { VideoRecorder, isRecordingSupported } from "../output/VideoRecorder";
import { canEditObjectFromStatus } from "../state/object-edit-lock";
import { ModelLoader, resolveModelCacheId } from "../loaders/ModelLoader";
import { TelemetryController } from "../state/TelemetryController";
import { SceneManager } from "./SceneManager";
import { domGetCssVar, readThemeColors } from "./ThemeBridge";
import { SceneObject } from "../objects/SceneObject";
import { SceneObjectRegistry } from "../objects/SceneObjectRegistry";
import {
  shouldShowTransformCenterMarker,
  TransformCenterMarker,
} from "../objects/TransformCenterMarker";
import { SelectionManager } from "../state/SelectionManager";
import { MotorSelectionManager } from "../state/MotorSelectionManager";
import { SelectionBoxManager } from "../state/SelectionBoxManager";
import { PickController } from "../picking/PickController";
import { raycastGroundPlane } from "../picking/raycast-ground";
import { ViewportManager } from "../viewports/ViewportManager";
import { ViewportSaver } from "../cameras/ViewportSaver";
import { alignByBounds, distributePositions } from "../tools/SceneBuildTools";
import { TransformController } from "../tools/TransformController";
import {
  intersectModelRotationAxes,
  resolveModelRotationAxes,
} from "../tools/rotation-xy-constraint";
import { MultiTransformPivot, computeSelectionCentroid } from "../tools/multi-transform-pivot";
import { SingleTransformPivot } from "../tools/single-transform-pivot";
import { shouldAbortFailedTransformCommit } from "../tools/transform-commit-guard";
import { applyWorldTransform, readWorldTransform } from "../tools/read-world-transform";
import {
  resolveTransformCenterOffset,
  type TransformCenterPreset,
} from "../tools/transform-center";
import { BoundingBox } from "../state/BoundingBox";
import { GroupManager } from "../state/GroupManager";
import { MeasureMarkers } from "../state/MeasureMarkers";
import {
  groundDistanceFromAabb,
  minDistanceBetweenAabbs,
  type AABB,
} from "../measure/measure-distance";
import { selectIdsInScreenRect } from "../picking/box-select-screen";
import { isTransformToolMode } from "../tool-mode";
import {
  getWorldBounds,
  getWorldPosition,
  projectWorldToScreen,
  setNodeMetadata,
  type WorldBounds,
} from "../babylon/utils";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import {
  DEFAULT_TOP_VIEW_MAX_EDGE_PX,
  resolveTopViewBoundsMm,
  resolveTopViewPixelSize,
  type CaptureObjectTopViewOptions,
  type ObjectTopViewCapture,
} from "./capture-object-top-view";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";
import { GoShadowController, type GoShadowEntry } from "../state/GoShadowController";
import {
  SequencePreviewController,
  type SequencePreviewEntries,
} from "../state/SequencePreviewController";
import { DimmedObjects } from "../state/DimmedObjects";
import {
  DEFAULT_HOIST_LABEL_MODE,
  parseHoistLabelMode,
  type HoistLabelMode,
} from "../hoist-label-mode";

export type { CaptureObjectTopViewOptions, ObjectTopViewCapture } from "./capture-object-top-view";

/** Layer bit used only for offscreen object top-view capture. */
const TOP_VIEW_CAPTURE_LAYER = 0x4000_0000;

export type Viz3DEventMap = {
  ready: void;
  resize: SlotRect;
  selectionChange: string[];
  motorSelectionChange: string | null;
  objectClick: { id: string | null; mode: SelectionMode };
  pickClick: { target: PickTarget | null; mode: SelectionMode };
  viewChange: ViewPreset;
  gridSizeChange: GridSizeM;
  layoutChange: ViewportLayout;
  modeChange: ToolMode;
  transformStart: { id: string };
  transformEnd: TransformEndPayload;
  transformEndBatch: TransformEndPayload[];
  transformCancel: void;
  groupChange: { groups: string[] };
  modelLoaded: ModelLoadedPayload;
  measure: MeasurePayload;
  recordingState: RecordingStatePayload;
  hoistLabelModeChange: HoistLabelMode;
};

export class Viz3DEngine implements Disposable {
  readonly events = new Emitter<Viz3DEventMap>();

  private canvas: HTMLCanvasElement | null = null;
  private babylonEngine: AbstractEngine | null = null;
  /** 使异步 WebGPU 初始化可被 unmount 取消 */
  private mountGeneration = 0;
  private pixelRatioCap = 2;
  private sceneManager: SceneManager | null = null;
  private objectRegistry: SceneObjectRegistry | null = null;
  private selectionManager: SelectionManager | null = null;
  private motorSelectionManager: MotorSelectionManager | null = null;
  private pickController: PickController | null = null;
  private viewportManager: ViewportManager | null = null;
  private readonly viewportSaver = new ViewportSaver();
  private mode: ToolMode = "select";
  private hoistLabelMode: HoistLabelMode = DEFAULT_HOIST_LABEL_MODE;
  private followTarget: string | null = null;
  private videoRecorder: VideoRecorder | null = null;
  private colors = readThemeColors(domGetCssVar);
  private telemetryController: TelemetryController | null = null;
  private goShadowController: GoShadowController | null = null;
  private sequencePreviewController: SequencePreviewController | null = null;
  /** 动作页成员标识：非成员 visibility 0.7；跨 unmount 保留，dispose 时清空 */
  private readonly dimmedObjects = new DimmedObjects();
  /** Session display unit for telemetry labels; default mm until React injects. */
  private displayLengthUnit: DisplayLengthUnit = "mm";
  private slotElement: HTMLElement | null = null;
  private transformController: TransformController | null = null;
  private groupManager: GroupManager | null = null;
  private readonly groupNodes = new Map<string, TransformNode>();
  private readonly boundingBoxes = new Map<string, BoundingBox>();
  private modelLoader: ModelLoader | null = null;
  private measureMarkers: MeasureMarkers | null = null;
  private boxSelectEnabled = true;
  /** 搭建界面专属：变换中心标记等场景编辑可视化 */
  private sceneEditEnabled = false;
  private selectionBoxManager: SelectionBoxManager | null = null;
  private transformCenterMarker: TransformCenterMarker | null = null;
  private singleTransformPivot: SingleTransformPivot | null = null;
  private singleTransformMemberId: string | null = null;
  private multiTransformPivot: MultiTransformPivot | null = null;
  private multiTransformMemberIds: string[] = [];
  private mounted = false;
  private visibilityHandler: (() => void) | null = null;
  /** mount 异步完成前暂存，bootstrap 后刷入 */
  private pendingSavedView: SavedView | null = null;

  mount(canvas: HTMLCanvasElement, options: Viz3DOptions = {}): void {
    if (this.mounted && this.canvas === canvas) {
      this.resize();
      return;
    }

    this.unmount();

    this.canvas = canvas;
    this.slotElement = canvas.parentElement;
    this.pixelRatioCap = options.pixelRatioCap ?? 2;
    canvas.style.touchAction = "none";

    const generation = ++this.mountGeneration;
    this.mounted = true;
    // 由调用方在 mount 后再次 applySavedView；避免刷入上一次工程的 pending
    this.pendingSavedView = null;

    this.visibilityHandler = () => {
      if (!this.babylonEngine || !this.mounted) {
        return;
      }
      if (document.hidden) {
        this.babylonEngine.stopRenderLoop();
        return;
      }
      this.babylonEngine.runRenderLoop(() => {
        this.renderFrame();
      });
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    void this.bootstrapAndStart(generation);
  }

  unmount(): void {
    this.mountGeneration += 1;

    if (!this.mounted && !this.babylonEngine) {
      return;
    }

    this.babylonEngine?.stopRenderLoop();

    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }

    this.releaseSingleTransform();
    this.singleTransformPivot?.dispose();
    this.singleTransformPivot = null;

    this.releaseMultiTransform();
    this.multiTransformPivot?.dispose();
    this.multiTransformPivot = null;

    this.transformController?.dispose();
    this.transformController = null;

    this.transformCenterMarker?.dispose();
    this.transformCenterMarker = null;

    this.boundingBoxes.forEach((bbox) => bbox.dispose());
    this.boundingBoxes.clear();

    this.selectionBoxManager?.dispose();
    this.selectionBoxManager = null;

    this.groupNodes.forEach((node) => node.dispose());
    this.groupNodes.clear();
    this.groupManager = null;

    this.objectRegistry?.dispose();
    this.objectRegistry = null;
    this.selectionManager = null;
    this.motorSelectionManager = null;
    this.pickController = null;

    this.modelLoader?.dispose();
    this.modelLoader = null;

    this.telemetryController?.dispose();
    this.telemetryController = null;

    this.goShadowController?.dispose();
    this.goShadowController = null;

    this.sequencePreviewController?.dispose();
    this.sequencePreviewController = null;

    this.measureMarkers?.dispose();
    this.measureMarkers = null;

    this.viewportManager?.dispose();
    this.viewportManager = null;
    // 保留 pendingSavedView：remount 后仍可刷入（ViewportSlot 也会再推一次）

    this.sceneManager?.dispose();
    this.sceneManager = null;

    this.babylonEngine?.dispose();
    this.babylonEngine = null;

    this.canvas = null;
    this.slotElement = null;
    this.mounted = false;
  }

  resize(): void {
    if (!this.babylonEngine || !this.canvas) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const ratio = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      this.pixelRatioCap,
    );
    // setHardwareScalingLevel internally calls engine.resize() which sets
    // canvas.width = clientWidth / scalingLevel = clientWidth * ratio (DPR-scaled).
    // DO NOT call setSize() afterward — that would override the DPR-scaled canvas
    // back to CSS dimensions, causing scene.pick to double-scale its coordinates.
    this.babylonEngine.setHardwareScalingLevel(1 / ratio);

    this.events.emit("resize", {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  /** @deprecated continuous render loop handles frames */
  invalidate(): void {
    // no-op
  }

  getSlotRect(): SlotRect {
    if (!this.canvas) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const rect = this.canvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  setGridVisible(visible: boolean): void {
    this.sceneManager?.setGridVisible(visible);
  }

  getGridSize(): GridSizeM {
    return this.sceneManager?.getGridSize() ?? DEFAULT_GRID_SIZE_M;
  }

  setGridSize(size: GridSizeM): void {
    const next = normalizeGridSizeM(size);
    if (!this.sceneManager) return;
    if (this.sceneManager.getGridSize() === next) return;
    this.sceneManager.setGridSize(next);
    this.events.emit("gridSizeChange", next);
  }

  getHoistLabelMode(): HoistLabelMode {
    return this.hoistLabelMode;
  }

  setHoistLabelMode(mode: HoistLabelMode): void {
    const next = parseHoistLabelMode(mode);
    if (this.hoistLabelMode === next) return;
    this.hoistLabelMode = next;
    for (const handle of this.objectRegistry?.list() ?? []) {
      handle.refreshHoistLabels(next);
    }
    this.events.emit("hoistLabelModeChange", next);
  }

  setAxesVisible(_visible: boolean): void {
    // axes helper not implemented
  }

  setTheme(): void {
    this.colors = readThemeColors(domGetCssVar);
    this.sceneManager?.applyColors(this.colors);
    this.objectRegistry?.applyColors(this.colors);
    this.selectionBoxManager?.setColor(primaryColorHex(this.colors));
    this.transformCenterMarker?.setColor(this.colors.warning);
  }

  setObjects(configs: SceneObjectConfig[]): void {
    const shouldReattach = this.releaseTransformAttachmentsForObjectSync();
    this.objectRegistry?.sync(configs);
    this.applyDimmedObjects();
    this.syncTransformRotationAxes();
    if (shouldReattach) {
      this.syncTransformAttachment();
    }
  }

  updateObject(id: string, config: SceneObjectConfig): void {
    const shouldReattach = this.releaseTransformAttachmentsForObjectSync();
    this.objectRegistry?.get(id)?.applyConfig(config);
    this.applyDimmedObjects();
    this.syncTransformRotationAxes();
    if (shouldReattach) {
      this.syncTransformAttachment();
    }
  }

  removeObject(id: string): void {
    const shouldReattach = this.releaseTransformAttachmentsForObjectSync();
    this.objectRegistry?.remove(id);
    if (this.getSelection().includes(id)) {
      this.setSelection(this.getSelection().filter((value) => value !== id));
      return;
    }
    if (shouldReattach) {
      this.syncTransformAttachment();
    }
  }

  getObjectIds(): string[] {
    return this.objectRegistry?.list().map((handle) => handle.id) ?? [];
  }

  setStatus(id: string, status: SceneObjectStatus | undefined): void {
    this.objectRegistry?.get(id)?.setStatus(status);
  }

  setSelection(ids: string[]): void {
    this.selectionManager?.set(ids);
  }

  getSelection(): string[] {
    return this.selectionManager?.getSelection() ?? [];
  }

  clearSelection(): void {
    this.selectionManager?.clear();
  }

  getMotorSelection(): string | null {
    return this.motorSelectionManager?.getSelection() ?? null;
  }

  setMotorSelection(id: string | null): void {
    if (id) {
      this.selectionManager?.clear();
    }
    this.motorSelectionManager?.set(id);
  }

  clearMotorSelection(): void {
    this.motorSelectionManager?.clear();
  }

  getPose(): CameraPose | null {
    return this.viewportManager?.getPose() ?? null;
  }

  setOrthographicEnabled(enabled: boolean): void {
    this.viewportManager?.setOrthographicEnabled(enabled);
  }

  isOrthographic(): boolean {
    return this.viewportManager?.isOrthographic() ?? false;
  }

  getViewPreset(): ViewPreset {
    return this.viewportManager?.getViewPreset() ?? "persp";
  }

  getSavedView(): SavedView | null {
    if (!this.viewportManager) return null;
    return {
      ...this.viewportManager.getSavedView(),
      gridSize: this.getGridSize(),
    };
  }

  applySavedView(view: SavedView): void {
    if (!this.viewportManager) {
      this.pendingSavedView = view;
      return;
    }
    this.viewportManager.applySavedView(view);
    this.applyGridSizeFromView(view);
    this.pendingSavedView = null;
    this.events.emit("viewChange", view.preset);
  }

  private applyGridSizeFromView(view: SavedView): void {
    const next = normalizeGridSizeM(view.gridSize);
    if (!this.sceneManager) return;
    const prev = this.sceneManager.getGridSize();
    this.sceneManager.setGridSize(next);
    if (prev !== next) {
      this.events.emit("gridSizeChange", next);
    }
  }

  /** 截主画布为 PNG data URL（最长边约 960px） */
  captureCoverPngBase64(): string | null {
    if (!this.canvas) return null;
    const src = this.canvas;
    const maxEdge = 960;
    const sw = src.width || src.clientWidth;
    const sh = src.height || src.clientHeight;
    if (sw <= 0 || sh <= 0) return null;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    try {
      if (dw === sw && dh === sh) {
        return src.toDataURL("image/png");
      }
      const offscreen = document.createElement("canvas");
      offscreen.width = dw;
      offscreen.height = dh;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return src.toDataURL("image/png");
      ctx.drawImage(src, 0, 0, dw, dh);
      return offscreen.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  /**
   * Offscreen ortho top-down of one controlled object in local XZ.
   * Does not mutate the live viewport camera.
   * Aligns with MultiPointAxesCanvas: svgX=-x, svgY=z; units mm vs Babylon m.
   */
  async captureObjectTopViewPng(
    objectId: string,
    options?: CaptureObjectTopViewOptions,
  ): Promise<ObjectTopViewCapture | null> {
    const scene = this.sceneManager?.scene;
    const engine = this.babylonEngine;
    const handle = this.objectRegistry?.get(objectId);
    if (!scene || !engine || !handle) return null;

    const dims = handle.getConfig().dimensions;
    const boundsMm = resolveTopViewBoundsMm(dims);
    const pixels = resolveTopViewPixelSize(dims, options?.maxEdgePx ?? DEFAULT_TOP_VIEW_MAX_EDGE_PX);
    if (!boundsMm || !pixels) return null;

    const halfW = dims.w / 2;
    const halfD = dims.d / 2;
    const visual = asTransformNode(handle.selectionBoundsTarget);
    const meshes = visual.getChildMeshes(false);
    if (meshes.length === 0) return null;

    const savedLayerMasks = meshes.map((mesh) => mesh.layerMask);
    this.transformController?.setHelperVisible(false);

    const camera = new FreeCamera(
      `viz3d-top-capture-${objectId}`,
      new Vector3(0, Math.max(dims.h, 0.5) + 1, 0),
      scene,
      false,
    );
    camera.parent = visual;
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    // Flip X so screen-right = model -X (matches svgX = -x). Top = model -Z (matches svgY = z).
    camera.orthoLeft = halfW;
    camera.orthoRight = -halfW;
    camera.orthoTop = halfD;
    camera.orthoBottom = -halfD;
    camera.minZ = 0.01;
    camera.maxZ = Math.max(dims.h, 0.5) * 4 + 10;
    // Look down local -Y with camera up along local -Z.
    camera.rotation.set(Math.PI / 2, Math.PI, 0);
    camera.layerMask = TOP_VIEW_CAPTURE_LAYER;

    try {
      for (const mesh of meshes) {
        if (mesh.name.includes("viz3d-front-marker")) continue;
        mesh.layerMask = TOP_VIEW_CAPTURE_LAYER;
      }

      const pngBase64 = await CreateScreenshotUsingRenderTargetAsync(
        engine,
        camera,
        { width: pixels.widthPx, height: pixels.heightPx },
        "image/png",
        1,
        true,
        undefined,
        false,
        false,
        true,
      );

      if (!pngBase64) return null;
      return {
        pngBase64,
        boundsMm,
        widthPx: pixels.widthPx,
        heightPx: pixels.heightPx,
      };
    } catch {
      return null;
    } finally {
      meshes.forEach((mesh, index) => {
        mesh.layerMask = savedLayerMasks[index] ?? 0x0fffffff;
      });
      camera.dispose();
      if (isTransformToolMode(this.mode)) {
        this.transformController?.setHelperVisible(true);
      }
    }
  }

  /** 已绑电机吊点的屏幕投影（供调试徽章锚定） */
  getBoundHoistScreenPositions(
    viewportWidth: number,
    viewportHeight: number,
  ): Array<{ motorId: string; objectId: string; x: number; y: number; visible: boolean }> {
    const scene = this.sceneManager?.scene;
    if (!scene || !this.objectRegistry) return [];
    const results: Array<{ motorId: string; objectId: string; x: number; y: number; visible: boolean }> = [];
    for (const handle of this.objectRegistry.list()) {
      const config = handle.getConfig();
      const axes = config.hoistAxes ?? [];
      for (const axis of axes) {
        if (!axis.motorId) continue;
        const root = handle.getHoistPointRoot(axis.motorId);
        if (!root) continue;
        const world = getWorldPosition(root);
        const screen = projectWorldToScreen(world, scene, viewportWidth, viewportHeight);
        results.push({
          motorId: axis.motorId,
          objectId: handle.id,
          x: screen.x,
          y: screen.y,
          visible: screen.visible,
        });
      }
    }
    return results;
  }

  setView(preset: ViewPreset): void {
    this.viewportManager?.setView(preset);
    this.events.emit("viewChange", preset);
  }

  setLayout(layout: ViewportLayout): void {
    this.viewportManager?.setLayout(layout);
    this.events.emit("layoutChange", layout);
  }

  getLayout(): ViewportLayout {
    return this.viewportManager?.getLayout() ?? "single";
  }

  setSplit(split: ViewportSplit): void {
    this.viewportManager?.setSplit(split);
  }

  getSplit(): ViewportSplit {
    return this.viewportManager?.getSplit() ?? { x: 0.5, y: 0.5 };
  }

  setMode(mode: ToolMode): void {
    this.mode = mode;
    this.viewportManager?.setMode(mode);

    if (isTransformToolMode(mode)) {
      this.ensureTransformController();
      this.transformController?.setHelperVisible(true);
      this.transformController?.setMode(mode);
      this.transformController?.setEnabled(true);
      this.syncTransformAttachment();
    } else {
      this.teardownTransformUI();
    }

    this.setOrbitEnabled(true);
    this.events.emit("modeChange", mode);
  }

  setOrbitEnabled(enabled: boolean): void {
    this.viewportManager?.setOrbitEnabled(enabled);
    if (enabled) {
      this.syncFollowOrbitConstraints();
    }
  }

  private syncFollowOrbitConstraints(): void {
    // 正交视角必须锁 alpha/beta；勿被「菜单关闭后恢复 orbit」覆盖
    if (this.viewportManager?.isOrthographic()) {
      this.viewportManager.setOrbitRotateEnabled(false);
      return;
    }
    this.viewportManager?.setOrbitRotateEnabled(this.followTarget == null);
  }

  applyWheelZoom(deltaY: number): void {
    this.viewportManager?.cancelFocusAnimation();
    this.viewportManager?.getControls()?.applyWheelZoom(deltaY);
  }

  getMode(): ToolMode {
    return this.mode;
  }

  hitsTransformHandle(canvasX: number, canvasY: number): boolean {
    return this.transformController?.hitsHandle(canvasX, canvasY) ?? false;
  }

  setTransformMode(mode: TransformMode): void {
    this.transformController?.setMode(mode);
  }

  setPivot(id: string, offset: Vec3): PivotChangePayload | null {
    if (!this.canEditObject(id)) {
      return null;
    }
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return null;
    }
    const shouldReattach = this.releaseTransformAttachmentsForObjectSync();
    handle.setCenterOffset(offset);
    const config = handle.getConfig();
    this.refreshBoundingBox(id);
    if (shouldReattach) {
      this.syncTransformAttachment();
    }
    return {
      id,
      position: config.position,
      centerOffset: config.centerOffset,
    };
  }

  setTransformCenter(id: string, preset: TransformCenterPreset): PivotChangePayload | null {
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return null;
    }
    return this.setPivot(id, resolveTransformCenterOffset(preset, handle.getConfig().dimensions));
  }

  setObjectColor(id: string, hex: string): void {
    this.objectRegistry?.get(id)?.setColor(hex);
  }

  align(ids: string[], mode: AlignMode): TransformEndPayload[] {
    const shouldReattach = this.releaseTransformAttachmentsForObjectSync();
    const editableIds = ids.filter((id) => this.canEditObject(id));
    const items = editableIds.flatMap((id) => {
      const handle = this.objectRegistry?.get(id);
      if (!handle) {
        return [];
      }
      const node = asTransformNode(handle.object3d);
      node.computeWorldMatrix(true);
      const world = node.getAbsolutePosition();
      const bounds = handle.getWorldBounds();
      return [
        {
          id,
          position: { x: world.x, y: world.y, z: world.z },
          min: bounds.min,
          max: bounds.max,
        },
      ];
    });
    const aligned = alignByBounds(items, mode);
    const payloads = editableIds.flatMap((id) => {
      const position = aligned[id];
      if (!position) {
        return [];
      }
      const payload = this.applyPosition(id, position);
      return payload ? [payload] : [];
    });
    if (shouldReattach) {
      this.syncTransformAttachment();
    }
    return payloads;
  }

  distribute(ids: string[], axis: AlignAxis): TransformEndPayload[] {
    const editableIds = ids.filter((id) => this.canEditObject(id));
    const items = editableIds.flatMap((id) => {
      const handle = this.objectRegistry?.get(id);
      if (!handle) {
        return [];
      }
      return [{ id, position: handle.getTransform().position }];
    });
    const distributed = distributePositions(items, axis);
    return editableIds.flatMap((id) => {
      const position = distributed[id];
      if (!position) {
        return [];
      }
      const payload = this.applyPosition(id, position);
      return payload ? [payload] : [];
    });
  }

  addBoundingBox(id: string, kind: BoundingBoxKind): void {
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return;
    }
    this.removeBoundingBox(id);
    const node = asTransformNode(handle.object3d);
    const bbox = new BoundingBox(node, kind, this.colors.warning);
    bbox.update(readObjectBounds(handle) as never);
    this.boundingBoxes.set(id, bbox);
  }

  removeBoundingBox(id: string): void {
    const bbox = this.boundingBoxes.get(id);
    if (!bbox) {
      return;
    }
    bbox.dispose();
    this.boundingBoxes.delete(id);
  }

  group(ids: string[]): string | null {
    const groupId = this.groupManager?.group(ids) ?? null;
    if (groupId) {
      this.events.emit("groupChange", { groups: this.getGroups() });
    }
    return groupId;
  }

  ungroup(groupId: string): void {
    this.groupManager?.ungroup(groupId);
    const groupNode = this.groupNodes.get(groupId);
    if (groupNode) {
      groupNode.dispose();
      this.groupNodes.delete(groupId);
    }
    this.events.emit("groupChange", { groups: this.getGroups() });
  }

  getGroups(): string[] {
    return this.groupManager?.getGroups() ?? [];
  }

  createAIModel(): never {
    throw new Error("AI model generation not implemented");
  }

  async loadModel(input: File | string, opts?: LoadModelOptions): Promise<string> {
    if (!this.modelLoader) {
      throw new Error("Viz3DEngine not initialized");
    }
    const key = resolveModelCacheId(input, opts);
    try {
      const { id, format } = await this.modelLoader.load(input, opts);
      this.events.emit("modelLoaded", { id, ok: true, format });
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit("modelLoaded", { id: key, ok: false, error: message });
      throw error;
    }
  }

  getModelIds(): string[] {
    return this.modelLoader?.ids() ?? [];
  }

  getModelNativeSizeMm(
    id: string,
  ): { width: number; height: number; depth: number } | undefined {
    return this.modelLoader?.getNativeSizeMm(id);
  }

  clearModels(): void {
    this.modelLoader?.clear();
  }

  saveViewport(name: string): void {
    if (!this.viewportManager) {
      return;
    }
    this.viewportSaver.save(name, this.viewportManager.getPose());
  }

  restoreViewport(name: string): boolean {
    const pose: CameraPose | undefined = this.viewportSaver.restore(name);
    if (!pose || !this.viewportManager) {
      return false;
    }
    this.viewportManager.applyPose(pose);
    return true;
  }

  listViewports(): string[] {
    return this.viewportSaver.list();
  }

  setFollowTarget(id: string | null): void {
    this.followTarget = id;
    this.syncFollowOrbitConstraints();
  }

  getFollowTarget(): string | null {
    return this.followTarget;
  }

  setFocalLength(mm: number): void {
    this.viewportManager?.setFocalLength(mm);
  }

  getFocalLength(): number {
    return this.viewportManager?.getFocalLength() ?? 50;
  }

  startRecording(opts?: RecordingOptions): void {
    if (!this.canvas) {
      throw new Error("Viz3DEngine not initialized");
    }
    if (!isRecordingSupported()) {
      this.events.emit("recordingState", {
        state: "unsupported",
        message: "MediaRecorder not supported",
      });
      throw new Error("MediaRecorder not supported");
    }
    try {
      if (!this.videoRecorder) {
        this.videoRecorder = new VideoRecorder();
      }
      this.videoRecorder.start(this.canvas, opts);
      this.events.emit("recordingState", { state: "recording" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit("recordingState", { state: "error", message });
      throw error;
    }
  }

  async stopRecording(): Promise<Blob> {
    if (!this.videoRecorder?.isActive()) {
      throw new Error("Not recording");
    }
    const blob = await this.videoRecorder.stop();
    this.events.emit("recordingState", { state: "idle" });
    return blob;
  }

  isRecording(): boolean {
    return this.videoRecorder?.isActive() ?? false;
  }

  canEditObject(id: string): boolean {
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return false;
    }
    return canEditObjectFromStatus(handle.getConfig().status);
  }

  bindTelemetry(objectId: string, snapshotId: string): void {
    this.telemetryController?.bindTelemetry(objectId, snapshotId);
  }

  resolveSnapshotId(objectId: string): string | null {
    return this.telemetryController?.getBinder().resolveSnapshotId(objectId) ?? null;
  }

  resolveObjectId(snapshotId: string): string | null {
    return this.telemetryController?.getBinder().resolveObjectId(snapshotId) ?? null;
  }

  applyTelemetry(snapshots: TelemetrySnapshotInput[]): void {
    this.telemetryController?.applyTelemetry(snapshots);
  }

  /** Inject frozen session display unit for drive-unit speed labels (no React hooks here). */
  setDisplayLengthUnit(unit: DisplayLengthUnit): void {
    this.displayLengthUnit = unit;
    this.telemetryController?.setDisplayLengthUnit(unit);
  }

  getDisplayLengthUnit(): DisplayLengthUnit {
    return this.displayLengthUnit;
  }

  applyVirtualAxisPose(objectId: string, values: VirtualAxisValues): void {
    const handle = this.objectRegistry?.get(objectId);
    if (!handle) return;
    const config = handle.getConfig();
    if (!config.virtualAxes?.length) return;
    handle.applyRuntimeTransform(resolveVirtualAxisTransform(config, values));
  }

  setGoShadows(entries: GoShadowEntry[]): void {
    this.goShadowController?.set(entries);
  }

  clearGoShadows(): void {
    this.goShadowController?.clear();
  }

  setSequencePreview(entries: SequencePreviewEntries): void {
    this.sequencePreviewController?.set(entries);
  }

  clearSequencePreview(): void {
    this.sequencePreviewController?.clear();
  }

  setDimmedObjects(ids: string[]): void {
    this.dimmedObjects.set(ids);
    this.applyDimmedObjects();
  }

  private applyDimmedObjects(): void {
    this.dimmedObjects.apply(this.objectRegistry?.list() ?? []);
  }

  showDriveUnitLabel(id: string, fields: DriveUnitLabelFields | null): void {
    this.telemetryController?.showDriveUnitLabel(id, fields);
  }

  setDistanceMarkersVisible(on: boolean): void {
    this.measureMarkers?.setVisible(on);
  }

  enableBoxSelect(on: boolean): void {
    this.boxSelectEnabled = on;
  }

  isBoxSelectEnabled(): boolean {
    return this.boxSelectEnabled;
  }

  setSceneEditEnabled(enabled: boolean): void {
    this.sceneEditEnabled = enabled;
    if (!enabled) {
      this.transformCenterMarker?.hide();
    }
  }

  pickInRect(
    screenRect: ScreenRect,
    selectionMode: "replace" | "additive" = "replace",
  ): string[] {
    if (!this.objectRegistry || !this.selectionManager || !this.viewportManager || !this.sceneManager) {
      return [];
    }

    this.clearMotorSelection();

    const camera = this.viewportManager.getPrimaryCamera();
    const projectionRect = this.getLocalSlotRect();

    const items = this.objectRegistry.list().map((handle) => {
      const box = readObjectBounds(handle);
      const corners = boundsCorners(box).flatMap((corner) => {
        const projected = projectBoundsCorner(corner, camera, projectionRect);
        return projected ? [projected] : [];
      });
      return { id: handle.id, corners };
    });

    const ids = selectIdsInScreenRect(screenRect, items);
    if (selectionMode === "additive") {
      const merged = [...new Set([...this.getSelection(), ...ids])];
      this.selectionManager.set(merged);
      return merged;
    }
    this.selectionManager.set(ids);
    return ids;
  }

  measureMinDistance(idA: string, idB: string): MeasurePayload | null {
    const handleA = this.objectRegistry?.get(idA);
    const handleB = this.objectRegistry?.get(idB);
    if (!handleA || !handleB) {
      return null;
    }

    const aabbA = worldBoundsToAabb(readObjectBounds(handleA));
    const aabbB = worldBoundsToAabb(readObjectBounds(handleB));
    const result = minDistanceBetweenAabbs(aabbA, aabbB);

    const payload: MeasurePayload = {
      kind: "min",
      distance: result.distance,
      unit: "m",
      ids: [idA, idB],
      points: [result.pointA, result.pointB],
    };

    this.measureMarkers?.setSegment(
      result.pointA,
      result.pointB,
      `${result.distance.toFixed(2)} m`,
    );
    this.events.emit("measure", payload);
    return payload;
  }

  measureGroundDistance(id: string): MeasurePayload | null {
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return null;
    }

    const box = readObjectBounds(handle);
    const aabb = worldBoundsToAabb(box);
    const { distance, groundPoint } = groundDistanceFromAabb(aabb);
    const bottomPoint: Vec3 = {
      x: (box.min.x + box.max.x) / 2,
      y: box.min.y,
      z: (box.min.z + box.max.z) / 2,
    };

    const payload: MeasurePayload = {
      kind: "ground",
      distance,
      unit: "m",
      ids: [id],
      points: [bottomPoint, groundPoint],
    };

    this.measureMarkers?.setSegment(bottomPoint, groundPoint, `${distance.toFixed(2)} m`);
    this.events.emit("measure", payload);
    return payload;
  }

  focusObject(id: string): void {
    const handle = this.objectRegistry?.get(id);
    if (!handle || !this.viewportManager) {
      return;
    }
    const box = readObjectBounds(handle);
    const center = worldBoundsCenter(box);
    const distance = worldBoundsMaxExtent(box) * 2.5;
    this.viewportManager.focusOnWorldPoint(center, distance);
  }

  /** 聚焦当前选中物体（支持多选），保留观察方向，平滑缩放居中 */
  focusSelection(): void {
    const viewportManager = this.viewportManager;
    const objectRegistry = this.objectRegistry;
    if (!viewportManager || !objectRegistry) {
      return;
    }

    const selectedIds = this.getSelection();
    if (selectedIds.length === 0) {
      return;
    }

    const bounds = mergeFocusBounds(
      selectedIds.flatMap((id) => {
        const handle = objectRegistry.get(id);
        return handle ? [readObjectBounds(handle)] : [];
      }),
    );
    if (!bounds) {
      return;
    }

    const camera = viewportManager.getPrimaryCamera();
    const slotRect = this.getLocalSlotRect();
    const aspect = slotRect.height > 0 ? slotRect.width / slotRect.height : 1;
    const fit = resolveFocusFit(bounds, {
      fov: camera.fov,
      aspect,
      orthographic: viewportManager.isOrthographic(),
    });

    viewportManager.focusAnimated(fit.center, fit.distance, fit.orthoHalfHeight);
  }

  pickAt(
    canvasX: number,
    canvasY: number,
    mode: SelectionMode = "single",
    clearOnMiss = true,
  ): PickTarget | null {
    if (!this.pickController || !this.objectRegistry || !this.selectionManager || !this.viewportManager) {
      return null;
    }

    const slotRect = this.getLocalSlotRect();
    const target = this.viewportManager.getPickTarget(canvasX, canvasY, slotRect);
    if (!target) {
      return null;
    }

    const targets = this.objectRegistry
      .list()
      .map((handle) => asTransformNode(handle.object3d));
    const pickTarget = this.pickController.pick(canvasX, canvasY, target.camera, targets);

    if (pickTarget?.kind === "motor") {
      this.setMotorSelection(pickTarget.id);
    } else if (pickTarget?.kind === "hoist-axis") {
      if (pickTarget.motorId) {
        this.setMotorSelection(pickTarget.motorId);
      } else {
        this.clearMotorSelection();
        this.selectionManager.select(pickTarget.objectId, mode);
      }
    } else if (pickTarget?.kind === "object") {
      this.clearMotorSelection();
      this.selectionManager.select(pickTarget.id, mode);
    } else if (mode === "single" && clearOnMiss) {
      this.selectionManager.clear();
      this.clearMotorSelection();
    }

    this.events.emit("pickClick", { target: pickTarget, mode });
    const hitId =
      pickTarget?.kind === "object"
        ? pickTarget.id
        : pickTarget?.kind === "hoist-axis"
          ? pickTarget.objectId
          : null;
    this.events.emit("objectClick", { id: hitId, mode });
    return pickTarget;
  }

  /** 仅拾取，不改选择（供拖放绑定） */
  peekPickAt(canvasX: number, canvasY: number): PickTarget | null {
    if (!this.pickController || !this.objectRegistry || !this.viewportManager) {
      return null;
    }

    const slotRect = this.getLocalSlotRect();
    const target = this.viewportManager.getPickTarget(canvasX, canvasY, slotRect);
    if (!target) {
      return null;
    }

    const targets = this.objectRegistry
      .list()
      .map((handle) => asTransformNode(handle.object3d));
    return this.pickController.pick(canvasX, canvasY, target.camera, targets);
  }

  pickGroundAt(canvasX: number, canvasY: number): Vec3 | null {
    if (!this.viewportManager) {
      return null;
    }

    const slotRect = this.getLocalSlotRect();
    const target = this.viewportManager.getPickTarget(canvasX, canvasY, slotRect);
    if (!target) {
      return null;
    }

    return raycastGroundPlane(canvasX, canvasY, target.camera);
  }

  dispose(): void {
    this.unmount();
    this.dimmedObjects.clear();
    this.videoRecorder?.dispose();
    this.videoRecorder = null;
    this.events.clear();
  }

  private getLocalSlotRect(): SlotRect {
    if (!this.canvas) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    return {
      left: 0,
      top: 0,
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
  }

  private async bootstrapAndStart(generation: number): Promise<void> {
    try {
      await this.bootstrapCore();
    } catch (err) {
      console.error("[Viz3D] engine bootstrap failed", err);
      return;
    }

    if (generation !== this.mountGeneration || !this.mounted) {
      this.disposeBabylonEngineOnly();
      return;
    }

    if (this.pendingSavedView && this.viewportManager) {
      this.viewportManager.applySavedView(this.pendingSavedView);
      this.applyGridSizeFromView(this.pendingSavedView);
      this.events.emit("viewChange", this.pendingSavedView.preset);
      this.pendingSavedView = null;
    }

    this.babylonEngine?.runRenderLoop(() => {
      this.renderFrame();
    });
    this.events.emit("ready", undefined);
  }

  /** 优先 WebGPU，不可用或初始化失败时回退 WebGL */
  private async createPreferredEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
    const webglOptions = {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      adaptToDeviceRatio: false,
    } as const;

    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const webgpu = await WebGPUEngine.CreateAsync(canvas, {
          antialias: true,
          stencil: true,
          adaptToDeviceRatio: false,
        });
        if (import.meta.env.DEV) {
          console.info("[Viz3D] using WebGPU");
        }
        return webgpu;
      }
    } catch (err) {
      console.warn("[Viz3D] WebGPU init failed, falling back to WebGL", err);
    }

    if (import.meta.env.DEV) {
      console.info("[Viz3D] using WebGL");
    }
    return new Engine(canvas, true, webglOptions);
  }

  private disposeBabylonEngineOnly(): void {
    this.babylonEngine?.stopRenderLoop();
    this.babylonEngine?.dispose();
    this.babylonEngine = null;
  }

  private async bootstrapCore(): Promise<void> {
    if (!this.canvas) {
      return;
    }

    const colors = readThemeColors(domGetCssVar);
    const engine = await this.createPreferredEngine(this.canvas);

    if (!this.mounted || !this.canvas) {
      engine.dispose();
      return;
    }

    this.babylonEngine = engine;
    this.sceneManager = new SceneManager(engine, colors);
    this.sceneManager.attachEnvironment();

    const scene = this.sceneManager.scene;
    this.viewportManager = new ViewportManager(scene, () => {});
    this.viewportManager.setMode(this.mode);

    this.colors = readThemeColors(domGetCssVar);
    this.modelLoader = new ModelLoader(scene);
    const registry = new SceneObjectRegistry(sceneContainer(scene), (config) =>
      new SceneObject(
        config,
        scene,
        this.colors,
        (id) => this.modelLoader?.get(id),
        () => this.hoistLabelMode,
      ),
    );
    this.objectRegistry = registry;
    const objectBoundsLookup = (id: string) => registry.get(id)?.selectionBoundsTarget;
    this.selectionBoxManager = new SelectionBoxManager(
      objectBoundsLookup,
      primaryColorHex(this.colors),
    );
    this.selectionManager = new SelectionManager((ids) => {
      const visibleIds = ids.filter((id) => registry.get(id));
      this.selectionBoxManager?.syncObjects(visibleIds, objectBoundsLookup);
      this.events.emit("selectionChange", ids);
      if (isTransformToolMode(this.mode)) {
        this.syncTransformAttachment();
      }
    });
    this.pickController = new PickController();

    this.groupManager = new GroupManager((childId, parentGroupId) => {
      this.reparentObject(childId, parentGroupId);
    });

    this.telemetryController = new TelemetryController(
      registry,
      this.sceneManager.getLabelRenderer(),
      () => {},
      () => {},
    );
    this.telemetryController.setDisplayLengthUnit(this.displayLengthUnit);

    this.goShadowController = new GoShadowController(
      scene,
      (id) => registry.get(id),
      this.colors,
    );

    this.sequencePreviewController = new SequencePreviewController(
      scene,
      (id) => registry.get(id),
      this.colors,
    );

    this.motorSelectionManager = new MotorSelectionManager((id) => {
      const motorIds = id ? [id] : [];
      this.selectionBoxManager?.syncMotors(motorIds, (motorId) => {
        for (const handle of this.objectRegistry?.list() ?? []) {
          const root = handle.getHoistPointSelectionBoundsTarget(motorId);
          if (root) {
            return root;
          }
        }
        return undefined;
      });
      this.events.emit("motorSelectionChange", id);
    });

    this.measureMarkers = new MeasureMarkers(
      scene,
      this.sceneManager.getLabelRenderer(),
      this.colors.primary,
      this.colors.foreground,
    );

    this.resize();
  }

  private renderFrame(): void {
    if (!this.babylonEngine || !this.sceneManager || !this.viewportManager) {
      return;
    }

    if (this.followTarget) {
      const handle = this.objectRegistry?.get(this.followTarget);
      const controls = this.viewportManager.getControls();
      if (handle && controls) {
        const center = worldBoundsCenter(readObjectBounds(handle));
        applyCameraFollow(
          this.viewportManager.getPrimaryCamera(),
          controls,
          center,
        );
      }
    }

    this.selectionBoxManager?.update();
    this.syncTransformCenterMarker();

    const slotRect = this.getLocalSlotRect();
    this.viewportManager.tick(performance.now());
    this.viewportManager.render(this.babylonEngine, this.sceneManager.scene, slotRect);

    if (this.slotElement && slotRect.width > 0 && slotRect.height > 0) {
      this.telemetryController?.syncLabelPositions();
      this.sceneManager.renderLabels(
        this.viewportManager.getPrimaryCamera(),
        slotRect,
        this.slotElement,
      );
    }
  }

  private syncTransformCenterMarker(): void {
    const selectedIds = this.getSelection();
    if (!shouldShowTransformCenterMarker(this.mode, selectedIds, this.sceneEditEnabled)) {
      this.transformCenterMarker?.hide();
      return;
    }

    const id = selectedIds[0];
    const handle = id ? this.objectRegistry?.get(id) : undefined;
    const scene = this.sceneManager?.scene;
    if (!handle || !scene) {
      this.transformCenterMarker?.hide();
      return;
    }

    if (!this.transformCenterMarker) {
      this.transformCenterMarker = new TransformCenterMarker(scene, this.colors.warning);
    }

    const dimensions = handle.getConfig().dimensions;
    const maxExtent = Math.max(dimensions.w, dimensions.h, dimensions.d);
    const markerSize = Math.min(0.28, Math.max(0.08, maxExtent * 0.08));
    this.transformCenterMarker.show(handle.getTransformCenterWorldPosition(), markerSize);
  }

  private teardownTransformUI(): void {
    this.releaseSingleTransform();
    this.releaseMultiTransform();
    if (!this.transformController) {
      return;
    }
    this.transformController.detach();
    this.transformController.setHelperVisible(false);
    this.transformController.setEnabled(false);
  }

  private releaseTransformAttachmentsForObjectSync(): boolean {
    const shouldReattach = Boolean(
      this.transformController &&
      isTransformToolMode(this.mode) &&
      this.getEditableSelection().length > 0,
    );
    if (!shouldReattach) {
      return false;
    }
    this.transformController?.detach();
    this.releaseSingleTransform();
    this.releaseMultiTransform();
    return true;
  }

  private ensureTransformController(): void {
    if (this.transformController || !this.sceneManager || !this.viewportManager) {
      return;
    }

    this.transformController = new TransformController(this.sceneManager.scene, {
      onOrbitToggle: (enabled) => {
        this.viewportManager?.setOrbitEnabled(enabled);
      },
      onChange: () => {},
      onDragStart: () => {
        if (this.multiTransformMemberIds.length > 1) {
          const firstId = this.multiTransformMemberIds[0];
          if (firstId) {
            this.events.emit("transformStart", { id: firstId });
          }
          return;
        }
        const id = this.getTransformTargetId();
        if (id) {
          this.events.emit("transformStart", { id });
        }
      },
      onCommit: () => {
        if (this.multiTransformMemberIds.length > 1) {
          this.commitMultiTransform();
          return;
        }
        if (this.singleTransformMemberId) {
          this.commitSingleTransform();
          return;
        }
        // Single: object is attached directly (not under multi-pivot), so local === world.
        const id = this.getTransformTargetId();
        const handle = id ? this.objectRegistry?.get(id) : undefined;
        if (
          shouldAbortFailedTransformCommit({
            mode: "single",
            targetId: id,
            canEdit: Boolean(id && this.canEditObject(id)),
            hasHandle: Boolean(handle),
            payloadCount: 0,
          })
        ) {
          this.abortTransformDrag();
          return;
        }
        this.events.emit("transformEnd", this.captureAndBakeObjectPose(handle!));
      },
      onCancel: () => {
        this.emitTransformCancel();
      },
    });

    if (isTransformToolMode(this.mode)) {
      this.transformController.setMode(this.mode);
      this.transformController.setEnabled(true);
      this.syncTransformAttachment();
    }
  }

  private getEditableSelection(): string[] {
    return this.getSelection().filter((id) => this.canEditObject(id));
  }

  /** 选中物体控制类型变化时，刷新旋转 Gizmo 可用轴 */
  private syncTransformRotationAxes(): void {
    if (!this.transformController) {
      return;
    }
    const ids = this.getEditableSelection();
    if (ids.length === 0) {
      return;
    }
    this.transformController.setRotationAxes(
      intersectModelRotationAxes(
        ids.map((id) =>
          resolveModelRotationAxes(this.objectRegistry?.get(id)?.getConfig().rotationAxes),
        ),
      ),
    );
  }

  private syncTransformAttachment(): void {
    if (!this.transformController) {
      return;
    }

    const ids = this.getEditableSelection();
    if (ids.length === 0) {
      this.releaseSingleTransform();
      this.releaseMultiTransform();
      this.transformController.detach();
      this.multiTransformMemberIds = [];
      return;
    }

    this.syncTransformRotationAxes();

    if (ids.length === 1) {
      this.releaseSingleTransform();
      this.releaseMultiTransform();
      const handle = this.objectRegistry?.get(ids[0]);
      if (!handle) {
        this.transformController.detach();
        this.multiTransformMemberIds = [];
        return;
      }
      const scene = this.sceneManager?.scene;
      if (!scene) {
        this.transformController.detach();
        this.singleTransformMemberId = null;
        return;
      }
      if (!this.singleTransformPivot) {
        this.singleTransformPivot = new SingleTransformPivot(scene);
      }
      this.multiTransformMemberIds = [];
      this.singleTransformPivot.attach(
        asTransformNode(handle.object3d),
        handle.getTransformCenterWorldPosition(),
      );
      this.singleTransformMemberId = handle.id;
      this.transformController.attach(this.singleTransformPivot.pivot);
      return;
    }

    this.releaseSingleTransform();
    const scene = this.sceneManager?.scene;
    if (!scene || !this.objectRegistry) {
      this.transformController.detach();
      return;
    }

    const objects: TransformNode[] = [];
    const worldPositions: Vec3[] = [];

    for (const id of ids) {
      const handle = this.objectRegistry.get(id);
      if (!handle) {
        continue;
      }
      const node = asTransformNode(handle.object3d);
      const world = node.getAbsolutePosition();
      worldPositions.push({ x: world.x, y: world.y, z: world.z });
      objects.push(node);
    }

    if (objects.length < 2) {
      this.releaseMultiTransform();
      this.transformController.detach();
      this.multiTransformMemberIds = [];
      return;
    }

    if (!this.multiTransformPivot) {
      this.multiTransformPivot = new MultiTransformPivot(scene);
    }
    this.multiTransformPivot.mount(scene);
    this.multiTransformPivot.attach(objects, computeSelectionCentroid(worldPositions));
    this.multiTransformMemberIds = ids.filter((id) => this.objectRegistry?.get(id));
    this.transformController.attach(this.multiTransformPivot.pivot);
  }

  private releaseSingleTransform(): void {
    this.singleTransformPivot?.release();
    this.singleTransformMemberId = null;
  }

  private releaseMultiTransform(): void {
    this.multiTransformPivot?.release();
    this.multiTransformMemberIds = [];
  }

  /** Restore drag-start node transforms and emit transformCancel (Provider pairing). */
  abortTransformDrag(): void {
    this.transformController?.restoreAndCancel();
  }

  private emitTransformCancel(): void {
    if (this.multiTransformMemberIds.length > 1) {
      for (const id of this.multiTransformMemberIds) {
        this.refreshBoundingBox(id);
      }
    } else {
      const id = this.getTransformTargetId();
      if (id) {
        this.refreshBoundingBox(id);
      }
    }
    this.events.emit("transformCancel", undefined);
  }

  private commitSingleTransform(): void {
    const id = this.singleTransformMemberId;
    const handle = id ? this.objectRegistry?.get(id) : undefined;
    if (
      shouldAbortFailedTransformCommit({
        mode: "single",
        targetId: id,
        canEdit: Boolean(id && this.canEditObject(id)),
        hasHandle: Boolean(handle),
        payloadCount: 0,
      })
    ) {
      this.abortTransformDrag();
      return;
    }

    const pose = this.captureObjectWorldPose(handle!);
    this.transformController?.detach();
    this.singleTransformPivot?.release();
    this.singleTransformMemberId = null;
    this.bakeObjectWorldPose(handle!, pose);

    this.refreshBoundingBox(id!);
    this.events.emit("transformEnd", pose);
    this.syncTransformAttachment();
  }

  private commitMultiTransform(): void {
    const ids = [...this.multiTransformMemberIds];
    // Only decide which objects can commit; do NOT read transforms while parented to pivot
    // (getTransform reads local position/rotation/scale).
    const commitIds = ids.filter(
      (id) => this.canEditObject(id) && Boolean(this.objectRegistry?.get(id)),
    );

    if (
      shouldAbortFailedTransformCommit({
        mode: "multi",
        targetId: null,
        canEdit: true,
        hasHandle: true,
        payloadCount: commitIds.length,
      })
    ) {
      this.abortTransformDrag();
      return;
    }

    // Capture world poses while still parented to the gizmo pivot.
    const captured: TransformEndPayload[] = [];
    for (const id of commitIds) {
      const handle = this.objectRegistry?.get(id);
      if (!handle) {
        continue;
      }
      captured.push(this.captureObjectWorldPose(handle));
    }

    this.transformController?.detach();
    this.multiTransformPivot?.release();

    const pivot = this.multiTransformPivot?.pivot;
    if (pivot) {
      pivot.position.set(0, 0, 0);
      pivot.rotation.set(0, 0, 0);
      pivot.scaling.set(1, 1, 1);
      pivot.rotationQuaternion = null;
      pivot.computeWorldMatrix(true);
    }

    const payloads: TransformEndPayload[] = [];
    for (const pose of captured) {
      const handle = this.objectRegistry?.get(pose.id);
      if (!handle) {
        continue;
      }
      this.bakeObjectWorldPose(handle, pose);
      this.refreshBoundingBox(pose.id);
      payloads.push(pose);
    }

    if (
      shouldAbortFailedTransformCommit({
        mode: "multi",
        targetId: null,
        canEdit: true,
        hasHandle: true,
        payloadCount: payloads.length,
      })
    ) {
      // Handles vanished after release; still pair the Provider transaction.
      this.events.emit("transformCancel", undefined);
      return;
    }

    this.events.emit("transformEndBatch", payloads);

    if (isTransformToolMode(this.mode)) {
      queueMicrotask(() => {
        if (isTransformToolMode(this.mode)) {
          this.syncTransformAttachment();
        }
      });
    }
  }

  private getTransformTargetId(): string | null {
    if (this.multiTransformMemberIds.length === 1) {
      return this.multiTransformMemberIds[0];
    }
    const selection = this.getEditableSelection();
    return selection[0] ?? null;
  }

  private captureObjectWorldPose(handle: {
    id: string;
    object3d: unknown;
  }): TransformEndPayload {
    const world = readWorldTransform(asTransformNode(handle.object3d));
    return { id: handle.id, ...world };
  }

  private bakeObjectWorldPose(
    handle: { object3d: unknown },
    pose: TransformEndPayload,
  ): void {
    const node = asTransformNode(handle.object3d);
    if (node.parent) {
      return;
    }
    applyWorldTransform(node, pose);
  }

  private captureAndBakeObjectPose(handle: {
    id: string;
    object3d: unknown;
  }): TransformEndPayload {
    const pose = this.captureObjectWorldPose(handle);
    this.bakeObjectWorldPose(handle, pose);
    return pose;
  }

  private applyPosition(id: string, position: Vec3): TransformEndPayload | null {
    const handle = this.objectRegistry?.get(id);
    if (!handle) {
      return null;
    }
    asTransformNode(handle.object3d).position.set(position.x, position.y, position.z);
    this.refreshBoundingBox(id);
    const transform = handle.getTransform();
    return { id, ...transform };
  }

  private refreshBoundingBox(id: string): void {
    const bbox = this.boundingBoxes.get(id);
    const handle = this.objectRegistry?.get(id);
    if (!bbox || !handle) {
      return;
    }
    bbox.update(readObjectBounds(handle) as never);
  }

  private reparentObject(childId: string, parentGroupId: string | null): void {
    const handle = this.objectRegistry?.get(childId);
    const scene = this.sceneManager?.scene;
    if (!handle || !scene) {
      return;
    }

    const child = asTransformNode(handle.object3d);
    child.setParent(null, true);

    if (!parentGroupId) {
      child.setParent(null, true);
      return;
    }

    let groupNode = this.groupNodes.get(parentGroupId);
    if (!groupNode) {
      groupNode = new TransformNode(parentGroupId, scene);
      setNodeMetadata(groupNode, "viz3dGroupId", parentGroupId);
      this.groupNodes.set(parentGroupId, groupNode);
    }
    child.setParent(groupNode, true);
  }
}

const primaryColorHex = (colors: Viz3DColorMap): string =>
  `#${colors.primary.toString(16).padStart(6, "0")}`;

const asTransformNode = (node: unknown): TransformNode => node as TransformNode;

const readObjectBounds = (handle: SceneObjectHandle): WorldBounds =>
  getWorldBounds(asTransformNode(handle.selectionBoundsTarget));

const worldBoundsToAabb = (bounds: WorldBounds): AABB => ({
  min: bounds.min,
  max: bounds.max,
});

const worldBoundsCenter = (bounds: WorldBounds): Vec3 => ({
  x: (bounds.min.x + bounds.max.x) / 2,
  y: (bounds.min.y + bounds.max.y) / 2,
  z: (bounds.min.z + bounds.max.z) / 2,
});

const worldBoundsMaxExtent = (bounds: WorldBounds): number => {
  const sx = bounds.max.x - bounds.min.x;
  const sy = bounds.max.y - bounds.min.y;
  const sz = bounds.max.z - bounds.min.z;
  return Math.max(sx, sy, sz, 1);
};

const boundsCorners = (bounds: WorldBounds): Vec3[] => [
  { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
  { x: bounds.max.x, y: bounds.min.y, z: bounds.min.z },
  { x: bounds.min.x, y: bounds.max.y, z: bounds.min.z },
  { x: bounds.max.x, y: bounds.max.y, z: bounds.min.z },
  { x: bounds.min.x, y: bounds.min.y, z: bounds.max.z },
  { x: bounds.max.x, y: bounds.min.y, z: bounds.max.z },
  { x: bounds.min.x, y: bounds.max.y, z: bounds.max.z },
  { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
];

const projectBoundsCorner = (
  corner: Vec3,
  camera: Camera,
  projectionRect: SlotRect,
): { x: number; y: number } | null => {
  const viewport = camera.viewport.toGlobal(projectionRect.width, projectionRect.height);
  const projected = Vector3.Project(
    new Vector3(corner.x, corner.y, corner.z),
    Matrix.Identity(),
    camera.getTransformationMatrix(),
    viewport,
  );
  if (projected.z < 0 || projected.z > 1) {
    return null;
  }
  return {
    x: projected.x + projectionRect.left,
    y: projected.y + projectionRect.top,
  };
};

const sceneContainer = (scene: Scene) => ({
  add: (object: unknown) => {
    asTransformNode(object).setParent(null, true);
    void scene;
  },
  remove: (object: unknown) => {
    asTransformNode(object).dispose();
  },
});
