import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Scene } from "@babylonjs/core/scene";
import type {
  CameraPose,
  SavedCameraView,
  SavedView,
  SecondaryViewportCellId,
  SlotRect,
  Vec3,
  ViewPreset,
  ViewportCellId,
  ViewportCellInfo,
  ViewportLayout,
  ViewportSplit,
  ViewportState,
} from "../types";
import {
  clampSplit,
  computeViewportCells,
  DEFAULT_CELL_PRESETS,
  DEFAULT_SPLIT,
  findCellIndexAt,
  LAYOUT_CELL_IDS,
  VIEWPORT_CELL_IDS,
} from "./ViewportLayout";
import { ViewportCell } from "./ViewportCell";

export type PickTarget = { camera: Camera; screenRect: SlotRect; cellId: ViewportCellId };

export type ViewportCellRect = { id: ViewportCellId; rect: SlotRect };

const UNIT_RECT: SlotRect = { left: 0, top: 0, width: 1, height: 1 };

/**
 * 单 / 双 / 四视图：五格相机一次建好、一直保留，切布局只换显示哪几格，不重建相机。
 * 一次 scene.render() 画所有可见格（scene.activeCameras），当前格最后画，
 * 这样变换手柄、Babylon 指针拾取用的「最后一台相机」就是当前格。
 */
export class ViewportManager {
  private readonly cells = new Map<ViewportCellId, ViewportCell>();
  private layout: ViewportLayout = "single";
  private split: ViewportSplit = { ...DEFAULT_SPLIT };
  private activeId: ViewportCellId = "main";
  private maximizedId: ViewportCellId | null = null;
  /** 可见格的渲染顺序（当前格在最后）；布局、当前格、最大化变化时才重建 */
  private renderOrder: Camera[] = [];
  private renderOrderDirty = true;

  constructor(
    private readonly scene: Scene,
    private readonly onStateChange: () => void = () => {},
  ) {
    for (const id of VIEWPORT_CELL_IDS) {
      this.cells.set(id, new ViewportCell(scene, id, DEFAULT_CELL_PRESETS[id]));
    }
    this.getCell("main").setActive(true);
  }

  getLayout(): ViewportLayout {
    return this.layout;
  }

  getSplit(): ViewportSplit {
    return { ...this.split };
  }

  getActiveCellId(): ViewportCellId {
    return this.activeId;
  }

  getMaximizedCellId(): ViewportCellId | null {
    return this.maximizedId;
  }

  getActiveCell(): ViewportCell {
    return this.getCell(this.activeId);
  }

  getCell(id: ViewportCellId): ViewportCell {
    const cell = this.cells.get(id);
    if (!cell) {
      throw new Error(`unknown viewport cell ${id}`);
    }
    return cell;
  }

  /** 当前格的相机（框选、聚焦、标签、对齐图标方向都跟它） */
  getActiveCamera(): ArcRotateCamera {
    return this.getActiveCell().camera;
  }

  /**
   * 屏幕标签（遥测、驱动单元、虚轴、测量）和调试徽章固定画在主透视格，不随当前格跳；
   * 最大化了别的格（主格看不见）时画在放大的那格。
   */
  getLabelCellId(): ViewportCellId {
    const visible = this.getVisibleCellIds();
    return visible.includes("main") ? "main" : (visible[0] ?? "main");
  }

  /** 正在显示的格子，顺序同 computeViewportCells */
  getVisibleCellIds(): readonly ViewportCellId[] {
    if (this.maximizedId) {
      return [this.maximizedId];
    }
    return LAYOUT_CELL_IDS[this.layout];
  }

  setLayout(layout: ViewportLayout): void {
    if (layout === this.layout && this.maximizedId === null) {
      return;
    }
    this.applyLayout(layout, this.split);
  }

  setSplit(split: ViewportSplit): void {
    const next = clampSplit(split);
    if (next.x === this.split.x && next.y === this.split.y) {
      return;
    }
    this.split = next;
    this.onStateChange();
  }

  setActiveCell(id: ViewportCellId): void {
    if (id === this.activeId || !this.getVisibleCellIds().includes(id)) {
      return;
    }
    this.getCell(this.activeId).setActive(false);
    this.activeId = id;
    this.getCell(id).setActive(true);
    this.renderOrderDirty = true;
    this.onStateChange();
  }

  /** 多格时把一格放大到整个区域，再调一次还原；单视图无效 */
  toggleMaximize(id: ViewportCellId): void {
    if (this.maximizedId !== null) {
      this.maximizedId = null;
    } else {
      if (this.layout === "single" || !LAYOUT_CELL_IDS[this.layout].includes(id)) {
        return;
      }
      this.maximizedId = id;
      this.setActiveCell(id);
    }
    this.renderOrderDirty = true;
    this.onStateChange();
  }

  setOrbitEnabled(enabled: boolean): void {
    for (const cell of this.cells.values()) {
      cell.setOrbitEnabled(enabled);
    }
  }

  setCellView(id: ViewportCellId, preset: ViewPreset): void {
    this.getCell(id).setView(preset);
    this.onStateChange();
  }

  setCellOrthographic(id: ViewportCellId, enabled: boolean): void {
    this.getCell(id).setOrthographicEnabled(enabled);
    this.onStateChange();
  }

  setCellFollowTarget(id: ViewportCellId, objectId: string | null): void {
    this.getCell(id).setFollowTarget(objectId);
    this.onStateChange();
  }

  /** 正在跟随物体的可见格；渲染前逐格把目标移到物体中心 */
  forEachFollowingCell(fn: (cell: ViewportCell, objectId: string) => void): void {
    for (const id of this.getVisibleCellIds()) {
      const cell = this.getCell(id);
      const target = cell.getFollowTarget();
      if (target) {
        fn(cell, target);
      }
    }
  }

  getPose(): CameraPose {
    return this.getActiveCell().getPose();
  }

  applyPose(pose: CameraPose): void {
    this.getActiveCell().applyPose(pose);
  }

  setFocalLength(mm: number): void {
    this.getActiveCell().setFocalLength(mm);
  }

  getFocalLength(): number {
    return this.getActiveCell().getFocalLength();
  }

  /** 主格相机在顶层（兼容旧工程），其余格放 cells，布局和分隔放 layout / split */
  getSavedView(): Omit<SavedView, "gridSize"> {
    const cells: Partial<Record<SecondaryViewportCellId, SavedCameraView>> = {};
    for (const id of VIEWPORT_CELL_IDS) {
      if (id !== "main") {
        cells[id] = this.getCell(id).getSavedView();
      }
    }
    return {
      ...this.getCell("main").getSavedView(),
      cells,
      layout: this.layout,
      split: { ...this.split },
    };
  }

  applySavedView(view: SavedView): void {
    this.getCell("main").applySavedView(view);
    for (const id of VIEWPORT_CELL_IDS) {
      if (id === "main") continue;
      const saved = view.cells?.[id];
      if (saved) {
        this.getCell(id).applySavedView(saved);
      }
    }
    // 保存后会用同一份视图再套一次：布局没变就别动（保留最大化）
    const layout = view.layout ?? "single";
    const split = clampSplit(view.split ?? DEFAULT_SPLIT);
    if (layout !== this.layout || split.x !== this.split.x || split.y !== this.split.y) {
      this.applyLayout(layout, split);
    } else {
      this.onStateChange();
    }
  }

  focusOnWorldPoint(center: Vec3, distance: number): void {
    this.getActiveCell().focusOnWorldPoint(center, distance);
  }

  /** 推进各格进行中的聚焦动画 */
  tick(nowMs: number): void {
    for (const cell of this.cells.values()) {
      cell.tick(nowMs);
    }
  }

  cancelFocusAnimation(): void {
    this.getActiveCell().cancelFocusAnimation();
  }

  /** 可见格在画布里的矩形（CSS px，画布左上为原点） */
  getCellRects(slotRect: SlotRect): ViewportCellRect[] {
    const ids = this.getVisibleCellIds();
    const rects = computeViewportCells(
      this.maximizedId ? "single" : this.layout,
      { left: 0, top: 0, width: slotRect.width, height: slotRect.height },
      this.split,
    );
    return ids.map((id, index) => ({ id, rect: rects[index]! }));
  }

  getCellRect(id: ViewportCellId, slotRect: SlotRect): SlotRect | null {
    return this.getCellRects(slotRect).find((entry) => entry.id === id)?.rect ?? null;
  }

  getCellIdAt(localX: number, localY: number, slotRect: SlotRect): ViewportCellId | null {
    const entries = this.getCellRects(slotRect);
    const index = findCellIndexAt(
      entries.map((entry) => entry.rect),
      localX,
      localY,
    );
    return index === -1 ? null : entries[index]!.id;
  }

  getPickTarget(localX: number, localY: number, slotRect: SlotRect): PickTarget | null {
    const entries = this.getCellRects(slotRect);
    const index = findCellIndexAt(
      entries.map((entry) => entry.rect),
      localX,
      localY,
    );
    if (index === -1) {
      return null;
    }
    const { id, rect } = entries[index]!;
    return {
      camera: this.getCell(id).camera,
      cellId: id,
      screenRect: {
        left: slotRect.left + rect.left,
        top: slotRect.top + rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  /** 界面用：各可见格的位置（占比）与相机概况 */
  getState(): ViewportState {
    const cells: ViewportCellInfo[] = this.getCellRects({ ...UNIT_RECT }).map(({ id, rect }) => {
      const cell = this.getCell(id);
      return {
        id,
        rect,
        preset: cell.getPreset(),
        orthographic: cell.isOrthographic(),
        followTarget: cell.getFollowTarget(),
      };
    });
    return {
      layout: this.layout,
      split: { ...this.split },
      activeCellId: this.activeId,
      maximizedCellId: this.maximizedId,
      cells,
    };
  }

  render(scene: Scene, slotRect: SlotRect): void {
    const totalWidth = slotRect.width;
    const totalHeight = slotRect.height;
    if (totalWidth <= 0 || totalHeight <= 0) {
      return;
    }

    for (const { id, rect } of this.getCellRects(slotRect)) {
      const cell = this.getCell(id);
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      cell.prepareRender(width / height);
      const glY = totalHeight - (rect.top + rect.height);
      const viewport = cell.camera.viewport;
      const x = rect.left / totalWidth;
      const y = glY / totalHeight;
      const w = rect.width / totalWidth;
      const h = rect.height / totalHeight;
      if (viewport.x !== x || viewport.y !== y || viewport.width !== w || viewport.height !== h) {
        cell.camera.viewport = new Viewport(x, y, w, h);
      }
    }

    if (this.renderOrderDirty) {
      const ids = this.getVisibleCellIds().filter((id) => id !== this.activeId);
      this.renderOrder = [...ids, this.activeId].map((id) => this.getCell(id).camera);
      this.renderOrderDirty = false;
    }
    if (scene.activeCameras !== this.renderOrder) {
      scene.activeCameras = this.renderOrder;
    }
    scene.render();
  }

  dispose(): void {
    this.scene.activeCameras = [];
    for (const cell of this.cells.values()) {
      cell.dispose();
    }
    this.cells.clear();
    this.renderOrder = [];
  }

  private applyLayout(layout: ViewportLayout, split: ViewportSplit): void {
    this.layout = layout;
    this.split = clampSplit(split);
    this.maximizedId = null;
    if (!LAYOUT_CELL_IDS[layout].includes(this.activeId)) {
      this.getCell(this.activeId).setActive(false);
      this.activeId = "main";
      this.getCell("main").setActive(true);
    }
    this.renderOrderDirty = true;
    this.onStateChange();
  }

}
