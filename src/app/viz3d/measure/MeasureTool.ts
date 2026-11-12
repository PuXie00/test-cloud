import type { Vec3, ViewportCellId } from "../types";
import {
  hitTestRulers,
  MIN_RULER_LENGTH_M,
  rulerDeltaMm,
  rulerLengthMm,
  type MeasureEndpoint,
  type MeasureRuler,
  type MeasureSnapKind,
  type ProjectedRuler,
} from "./measure-rulers";

export type MeasurePoint = { point: Vec3; snap: MeasureSnapKind };

/** 画布坐标（CSS px）在某一格里落到哪个世界点；吊点 / 顶点吸附在这里做 */
export type MeasurePointResolver = (
  x: number,
  y: number,
  cellId: ViewportCellId,
  options: { snapVertices: boolean; coarse: boolean },
) => MeasurePoint | null;

/** 全部标尺在某一格里的投影（画布坐标） */
export type MeasureRulerProjector = (
  rulers: readonly MeasureRuler[],
  cellId: ViewportCellId,
) => ProjectedRuler[];

export type MeasureRulerInfo = { id: string; lengthMm: number; deltaMm: Vec3 };

export type MeasureState = {
  rulers: MeasureRulerInfo[];
  selectedId: string | null;
  /** 顶点吸附开关；按住 Ctrl 时临时反过来 */
  snapVertices: boolean;
};

export type MeasurePointerInput = {
  x: number;
  y: number;
  pointerId: number;
  /** Ctrl / ⌘：临时切换顶点吸附 */
  toggleSnap: boolean;
};

/** 正在拖的端点吸附到了什么（叠加层画吸附圈） */
export type MeasureDragSnap = { rulerId: string; endpoint: MeasureEndpoint; kind: MeasureSnapKind };

/** 和框选一样：移动超过 5px 才算拖 */
const DRAG_THRESHOLD_PX = 5;

const HIT_RADII = {
  fine: { endpoint: 10, segment: 6 },
  coarse: { endpoint: 22, segment: 16 },
} as const;

type DragState =
  | {
      kind: "create";
      pointerId: number;
      cellId: ViewportCellId;
      startX: number;
      startY: number;
      coarse: boolean;
      start: MeasurePoint | null;
      /** 拖过阈值后才建标尺 */
      rulerId: string | null;
      /** 按在某把标尺的线上：不拖就是选中它 */
      segmentHitId: string | null;
      previousSelectedId: string | null;
    }
  | {
      kind: "endpoint";
      pointerId: number;
      cellId: ViewportCellId;
      startX: number;
      startY: number;
      coarse: boolean;
      rulerId: string;
      endpoint: MeasureEndpoint;
      original: Vec3;
      moved: boolean;
    };

/**
 * 参考 Blender 测量工具：左键拖出标尺，拖端点改位置，点线选中，Delete 删除。
 * 标尺只存世界坐标，跟引擎走（切页面、重挂画布都还在），换工程时清空。
 */
export class MeasureTool {
  private rulers: MeasureRuler[] = [];
  private selectedId: string | null = null;
  private snapVertices = false;
  private drag: DragState | null = null;
  private dragSnap: MeasureDragSnap | null = null;
  private nextId = 1;

  constructor(
    private readonly resolvePoint: MeasurePointResolver,
    private readonly projectRulers: MeasureRulerProjector,
    private readonly onChange: () => void,
  ) {}

  getRulers(): readonly MeasureRuler[] {
    return this.rulers;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  getDragSnap(): MeasureDragSnap | null {
    return this.dragSnap;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  getState(): MeasureState {
    return {
      rulers: this.rulers.map((ruler) => ({
        id: ruler.id,
        lengthMm: rulerLengthMm(ruler),
        deltaMm: rulerDeltaMm(ruler),
      })),
      selectedId: this.selectedId,
      snapVertices: this.snapVertices,
    };
  }

  setSnapVertices(on: boolean): void {
    if (this.snapVertices === on) return;
    this.snapVertices = on;
    this.onChange();
  }

  select(id: string | null): void {
    const next = id !== null && this.rulers.some((ruler) => ruler.id === id) ? id : null;
    if (next === this.selectedId) return;
    this.selectedId = next;
    this.onChange();
  }

  /** 返回是否接手了这次按下；拖动中又按下另一根手指（双指相机手势）则放弃当前拖动 */
  pointerDown(input: MeasurePointerInput & { cellId: ViewportCellId; coarse: boolean }): boolean {
    if (this.drag) {
      if (this.drag.pointerId !== input.pointerId) this.cancelDrag();
      return false;
    }
    const point = { x: input.x, y: input.y };
    const hit = hitTestRulers(
      point,
      this.projectRulers(this.rulers, input.cellId),
      input.coarse ? HIT_RADII.coarse : HIT_RADII.fine,
      this.selectedId,
    );
    const base = {
      pointerId: input.pointerId,
      cellId: input.cellId,
      startX: input.x,
      startY: input.y,
      coarse: input.coarse,
    };

    if (hit?.kind === "endpoint") {
      const ruler = this.find(hit.id);
      if (!ruler) return false;
      this.drag = {
        ...base,
        kind: "endpoint",
        rulerId: ruler.id,
        endpoint: hit.endpoint,
        original: { ...ruler[hit.endpoint] },
        moved: false,
      };
      this.select(ruler.id);
      return true;
    }

    this.drag = {
      ...base,
      kind: "create",
      start: this.resolve(input.x, input.y, input.cellId, input.toggleSnap, input.coarse),
      rulerId: null,
      segmentHitId: hit?.id ?? null,
      previousSelectedId: this.selectedId,
    };
    return true;
  }

  pointerMove(input: MeasurePointerInput): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== input.pointerId) return;
    const overThreshold =
      Math.abs(input.x - drag.startX) > DRAG_THRESHOLD_PX ||
      Math.abs(input.y - drag.startY) > DRAG_THRESHOLD_PX;

    if (drag.kind === "create") {
      if (drag.rulerId === null && (!overThreshold || !drag.start)) return;
      const end = this.resolve(input.x, input.y, drag.cellId, input.toggleSnap, drag.coarse);
      if (!end) return;
      if (drag.rulerId === null) {
        const ruler: MeasureRuler = { id: `ruler-${this.nextId++}`, a: drag.start!.point, b: end.point };
        this.rulers.push(ruler);
        drag.rulerId = ruler.id;
        this.selectedId = ruler.id;
      } else {
        const ruler = this.find(drag.rulerId);
        if (!ruler) return;
        ruler.b = end.point;
      }
      this.dragSnap = { rulerId: drag.rulerId, endpoint: "b", kind: end.snap };
      this.onChange();
      return;
    }

    if (!drag.moved && !overThreshold) return;
    const ruler = this.find(drag.rulerId);
    const next = this.resolve(input.x, input.y, drag.cellId, input.toggleSnap, drag.coarse);
    if (!ruler || !next) return;
    drag.moved = true;
    ruler[drag.endpoint] = next.point;
    this.dragSnap = { rulerId: ruler.id, endpoint: drag.endpoint, kind: next.snap };
    this.onChange();
  }

  pointerUp(input: MeasurePointerInput): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== input.pointerId) return;
    this.pointerMove(input);
    this.drag = null;
    this.dragSnap = null;

    if (drag.kind === "create") {
      if (drag.rulerId === null) {
        // 没拖：点在线上选中那把，点空白取消选中
        this.selectedId = drag.segmentHitId;
      } else {
        const ruler = this.find(drag.rulerId);
        if (ruler && rulerLengthMm(ruler) / 1000 < MIN_RULER_LENGTH_M) {
          this.remove(ruler.id);
          this.selectedId = drag.previousSelectedId;
        }
      }
    } else if (drag.moved) {
      const ruler = this.find(drag.rulerId);
      // 两端吸到同一点：不留零长标尺，退回拖之前
      if (ruler && rulerLengthMm(ruler) / 1000 < MIN_RULER_LENGTH_M) {
        ruler[drag.endpoint] = drag.original;
      }
    }
    this.onChange();
  }

  /** 放弃进行中的拖动：新画的标尺删掉，拖动的端点退回原处 */
  cancelDrag(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    this.dragSnap = null;
    if (drag.kind === "create") {
      if (drag.rulerId !== null) {
        this.remove(drag.rulerId);
        this.selectedId = drag.previousSelectedId;
      }
    } else {
      const ruler = this.find(drag.rulerId);
      if (ruler) ruler[drag.endpoint] = drag.original;
    }
    this.onChange();
    return true;
  }

  deleteSelected(): boolean {
    if (this.selectedId === null || this.drag) return false;
    this.remove(this.selectedId);
    this.selectedId = null;
    this.onChange();
    return true;
  }

  clear(): void {
    if (this.rulers.length === 0 && !this.drag) return;
    this.drag = null;
    this.dragSnap = null;
    this.rulers = [];
    this.selectedId = null;
    this.onChange();
  }

  private resolve(
    x: number,
    y: number,
    cellId: ViewportCellId,
    toggleSnap: boolean,
    coarse: boolean,
  ): MeasurePoint | null {
    return this.resolvePoint(x, y, cellId, { snapVertices: this.snapVertices !== toggleSnap, coarse });
  }

  private find(id: string): MeasureRuler | undefined {
    return this.rulers.find((ruler) => ruler.id === id);
  }

  private remove(id: string): void {
    this.rulers = this.rulers.filter((ruler) => ruler.id !== id);
  }
}
