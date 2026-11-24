import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { SceneObjectConfig, SlotRect, ViewportCellId, VirtualAxisId } from "../types";
import {
  createPoseHandleDragSession,
  type DragFrame,
  type DragMember,
  type PoseHandleDragSession,
  type SnapCandidate,
} from "./pose-handle-drag";
import { toFullAxisValues, type PoseKinematics } from "./pose-handle-kinematics";
import {
  hitTestHandles,
  layoutPoseHandle,
  liftGapAmong,
  poseHandleKey,
  type CellProjector,
  type HandleLayout,
} from "./pose-handle-layout";
import { addVec, crossVec, distancePt, scaleVec, type Pt, type Ray } from "./pose-handle-math";
import { poseHandleModel, type PoseHandleModel } from "./pose-handle-model";
import type { OverlayCell, OverlayDrag, OverlayHandle, PoseHandleOverlay } from "./PoseHandleOverlay";
import {
  POSE_HANDLE_AXES,
  type PoseHandleBlockedEvent,
  type PoseHandleDragEndEvent,
  type PoseHandleDragEvent,
  type PoseHandleDragStartEvent,
  type PoseHandleKind,
  type PoseHandleTarget,
} from "./pose-handle-types";

/** 一格视口：画布坐标的位置、投影和取视线 */
export type PoseHandleHostCell = {
  id: ViewportCellId;
  rect: SlotRect;
  projector: CellProjector;
  rayAt: (point: Pt) => Ray | null;
};

/** 引擎给手柄的接口：哪几格、物体配置、父物体姿态、吸附参照、事件出口 */
export type PoseHandleHost = {
  getCells: () => PoseHandleHostCell[];
  getConfig: (objectId: string) => SceneObjectConfig | undefined;
  /** 父物体运动枢轴的世界矩阵；手柄挂在影子上、父物体也有影子时用父物体影子的 */
  getParentWorld: (objectId: string, onShadow: boolean) => Matrix | null;
  getSnapCandidates: (moving: ReadonlySet<string>) => SnapCandidate[];
  setOrbitEnabled: (enabled: boolean) => void;
  setCursor: (cursor: string | null) => void;
  onDragStart: (event: PoseHandleDragStartEvent) => void;
  onDrag: (event: PoseHandleDragEvent) => void;
  onDragEnd: (event: PoseHandleDragEndEvent) => void;
  onBlocked: (event: PoseHandleBlockedEvent) => void;
};

/** 按住手柄后移动这么多像素才算开始拖：只点一下不改位姿 */
export const POSE_HANDLE_DRAG_START_PX = 3;

type Pending = { pointerId: number; start: Pt; cellId: ViewportCellId; objectId: string; kind: PoseHandleKind };

type ActiveDrag = {
  pointerId: number;
  cellId: ViewportCellId;
  objectId: string;
  kind: PoseHandleKind;
  session: PoseHandleDragSession;
  members: DragMember[];
  frame: DragFrame | null;
};

const clampTo = (value: number, range?: { min: number; max: number }): number =>
  range ? Math.min(range.max, Math.max(range.min, value)) : value;

const formatPlain = (value: number): string => {
  const text = value.toFixed(1);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
};

const defaultDescribe = (axis: VirtualAxisId, value: number, delta: number): string =>
  `${axis} ${formatPlain(value)} (${delta >= 0 ? "+" : ""}${formatPlain(delta)})`;

const rectContains = (rect: SlotRect, point: Pt): boolean =>
  point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

/**
 * 动作页 3D 位姿手柄：每帧按目标算出各格的手柄形状并画出来；按下手柄、拖动、松手、Esc 取消。
 * 只改位姿（经事件交给动作编辑器），从不直接动设备。
 */
export class PoseHandleController {
  private targets: PoseHandleTarget[] = [];
  private readonly layouts = new Map<ViewportCellId, HandleLayout[]>();
  private hovered: { key: string; blocked: boolean } | null = null;
  private pending: Pending | null = null;
  private drag: ActiveDrag | null = null;
  private shown = false;
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finish(true);
  };

  constructor(
    private readonly host: PoseHandleHost,
    private readonly overlay: PoseHandleOverlay | null,
  ) {}

  setTargets(targets: readonly PoseHandleTarget[]): void {
    this.targets = [...targets];
    if (this.targets.length === 0) {
      this.pending = null;
      this.setHovered(null);
    }
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  /** 每帧调用 */
  render(): void {
    this.layouts.clear();
    if (this.targets.length === 0 && !this.drag) {
      // 别的页面每帧都走这里：没画过就什么都不做
      if (this.shown) {
        const cells = this.host.getCells();
        this.overlay?.render(cells.map((cell) => ({ id: cell.id, rect: cell.rect, handles: [], drag: null })));
      }
      this.shown = false;
      return;
    }
    const cells = this.host.getCells();
    const models = this.models();
    const overlayCells: OverlayCell[] = cells.map((cell) => {
      const layouts = models.flatMap(({ target, model }) => {
        const siblings = models.filter((entry) => entry.target === target).map((entry) => entry.model);
        const layout = layoutPoseHandle(target.objectId, model, cell.projector, {
          liftGapPx: model.kind === "lift" ? liftGapAmong(siblings, cell.projector) : undefined,
        });
        return layout ? [layout] : [];
      });
      this.layouts.set(cell.id, layouts);
      return {
        id: cell.id,
        rect: cell.rect,
        handles: layouts.map((layout) => this.overlayHandle(layout)),
        drag: this.overlayDrag(cell, layouts),
      };
    });
    this.overlay?.render(overlayCells);
    this.shown = true;
  }

  /** 按在手柄上时返回 true（这次按下归手柄，不框选）；拖不了的手柄也返回 true 并提示原因 */
  pointerDown(point: Pt, pointerId: number): boolean {
    if (this.drag || this.targets.length === 0) return false;
    const cell = this.host.getCells().find((entry) => rectContains(entry.rect, point));
    if (!cell) return false;
    const hit = hitTestHandles(this.layouts.get(cell.id) ?? [], point);
    const target = hit ? this.targetOf(hit.layout.objectId) : undefined;
    if (!hit || !target) return false;
    if (target.blockedReason) {
      this.host.onBlocked({ objectId: target.objectId, reason: target.blockedReason });
      return true;
    }
    this.pending = { pointerId, start: point, cellId: cell.id, objectId: target.objectId, kind: hit.layout.kind };
    return true;
  }

  /** 拖动中（或按住手柄）返回 true；否则只更新悬停 */
  pointerMove(point: Pt, pointerId: number, fine: boolean): boolean {
    if (this.drag) {
      if (this.drag.pointerId === pointerId) this.apply(point, fine);
      return true;
    }
    if (this.pending) {
      if (this.pending.pointerId !== pointerId) return true;
      if (distancePt(point, this.pending.start) < POSE_HANDLE_DRAG_START_PX) return true;
      const pending = this.pending;
      this.pending = null;
      if (this.begin(pending)) this.apply(point, fine);
      return true;
    }
    this.hover(point);
    return false;
  }

  pointerUp(pointerId: number): boolean {
    if (this.drag) {
      if (this.drag.pointerId === pointerId) this.finish(false);
      return true;
    }
    if (this.pending) {
      if (this.pending.pointerId === pointerId) this.pending = null;
      return true;
    }
    return false;
  }

  /** 放弃拖动：位姿回到按下前 */
  cancel(): boolean {
    this.pending = null;
    if (!this.drag) return false;
    this.finish(true);
    return true;
  }

  hover(point: Pt | null): void {
    if (this.drag) return;
    if (!point || this.targets.length === 0) {
      this.setHovered(null);
      return;
    }
    const cell = this.host.getCells().find((entry) => rectContains(entry.rect, point));
    const hit = cell ? hitTestHandles(this.layouts.get(cell.id) ?? [], point) : null;
    const target = hit ? this.targetOf(hit.layout.objectId) : undefined;
    this.setHovered(hit && target ? { key: hit.layout.key, blocked: Boolean(target.blockedReason) } : null);
  }

  dispose(): void {
    if (this.drag) this.finish(true);
    this.pending = null;
    window.removeEventListener("keydown", this.handleKeyDown, true);
  }

  private targetOf(objectId: string): PoseHandleTarget | undefined {
    return this.targets.find((target) => target.objectId === objectId);
  }

  private kinematicsOf(target: PoseHandleTarget): PoseKinematics | null {
    const config = this.host.getConfig(target.objectId);
    if (!config?.kinematics) return null;
    return {
      config,
      values: toFullAxisValues(target.values),
      parentWorld: this.host.getParentWorld(target.objectId, target.onShadow ?? false),
    };
  }

  private models(): Array<{ target: PoseHandleTarget; model: PoseHandleModel }> {
    return this.targets.flatMap((target) => {
      const input = this.kinematicsOf(target);
      if (!input) return [];
      return target.kinds.flatMap((kind) => {
        const model = poseHandleModel(kind, input, target.ranges);
        return model ? [{ target, model }] : [];
      });
    });
  }

  private setHovered(next: { key: string; blocked: boolean } | null): void {
    if (this.hovered?.key === next?.key && this.hovered?.blocked === next?.blocked) return;
    this.hovered = next;
    this.host.setCursor(next ? (next.blocked ? "not-allowed" : "grab") : null);
  }

  private begin(pending: Pending): boolean {
    const cell = this.host.getCells().find((entry) => entry.id === pending.cellId);
    const lead = this.targetOf(pending.objectId);
    if (!cell || !lead) return false;
    // 同一种手柄的选中物体一起动（升降和旋转不混）；拖不了的不带
    const group = [
      lead,
      ...this.targets.filter((target) => target !== lead && !target.blockedReason && target.kinds.includes(pending.kind)),
    ];
    const members = group.flatMap((target): DragMember[] => {
      const input = this.kinematicsOf(target);
      return input ? [{ objectId: target.objectId, input, ranges: target.ranges }] : [];
    });
    if (members[0]?.objectId !== lead.objectId) return false;
    const session = createPoseHandleDragSession({
      kind: pending.kind,
      members,
      projector: cell.projector,
      rayAt: cell.rayAt,
      start: pending.start,
      snapCandidates: this.host.getSnapCandidates(new Set(members.map((member) => member.objectId))),
    });
    if (!session) return false;
    this.drag = {
      pointerId: pending.pointerId,
      cellId: pending.cellId,
      objectId: lead.objectId,
      kind: pending.kind,
      session,
      members,
      frame: null,
    };
    this.host.setOrbitEnabled(false);
    this.host.setCursor("grabbing");
    window.addEventListener("keydown", this.handleKeyDown, true);
    this.host.onDragStart({
      kind: pending.kind,
      objectId: lead.objectId,
      objectIds: members.map((member) => member.objectId),
    });
    // 编辑器可能当场拒绝（如这一刻加不了位姿）并取消
    return this.drag !== null;
  }

  private apply(point: Pt, fine: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    const frame = drag.session.update(point, { fine });
    if (!frame) return;
    drag.frame = frame;
    this.host.onDrag({ kind: drag.kind, objectId: drag.objectId, updates: frame.updates });
  }

  private finish(cancelled: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    window.removeEventListener("keydown", this.handleKeyDown, true);
    this.host.setOrbitEnabled(true);
    this.host.setCursor(this.hovered ? (this.hovered.blocked ? "not-allowed" : "grab") : null);
    this.host.onDragEnd({ cancelled });
  }

  /** 拖到的值超出行程时顶到哪一头 */
  private limitOf(objectId: string): "min" | "max" | null {
    const drag = this.drag;
    const requested = drag?.frame?.updates.find((update) => update.objectId === objectId)?.values;
    const ranges = this.targetOf(objectId)?.ranges ?? drag?.members.find((member) => member.objectId === objectId)?.ranges;
    if (!drag || !requested) return null;
    for (const axis of POSE_HANDLE_AXES[drag.kind]) {
      const value = requested[axis];
      const range = ranges?.[axis];
      if (value === undefined || !range) continue;
      if (value < range.min) return "min";
      if (value > range.max) return "max";
    }
    return null;
  }

  private overlayHandle(layout: HandleLayout): OverlayHandle {
    const target = this.targetOf(layout.objectId);
    const drag = this.drag;
    const dragging =
      drag !== null && drag.kind === layout.kind && drag.members.some((member) => member.objectId === layout.objectId);
    const state = target?.blockedReason
      ? "blocked"
      : dragging
        ? "active"
        : this.hovered?.key === layout.key
          ? "hover"
          : "idle";
    return { layout, state, atLimit: dragging ? this.limitOf(layout.objectId) : null };
  }

  private dragLabelText(): { text: string; warning: boolean } | null {
    const drag = this.drag;
    const frame = drag?.frame;
    if (!drag || !frame) return null;
    const lead = drag.members[0]!;
    const target = this.targetOf(drag.objectId);
    const describe = target?.describe ?? defaultDescribe;
    const requested = frame.updates.find((update) => update.objectId === drag.objectId)?.values ?? {};
    const parts: string[] = [];
    for (const axis of POSE_HANDLE_AXES[drag.kind]) {
      const raw = requested[axis];
      if (raw === undefined) continue;
      const value = clampTo(raw, target?.ranges?.[axis] ?? lead.ranges?.[axis]);
      parts.push(describe(axis, value, value - lead.input.values[axis]));
    }
    const limit = this.limitOf(drag.objectId);
    if (limit) parts.push(limit === "max" ? "已到行程上限" : "已到行程下限");
    return parts.length > 0 ? { text: parts.join("  "), warning: limit !== null } : null;
  }

  private overlayDrag(cell: PoseHandleHostCell, layouts: readonly HandleLayout[]): OverlayDrag | null {
    const drag = this.drag;
    const frame = drag?.frame;
    if (!drag || !frame) return null;
    const key = poseHandleKey(drag.objectId, drag.kind);
    const leadLayout = layouts.find((layout) => layout.key === key);
    const text = this.dragLabelText();
    const project = (point: Parameters<CellProjector["project"]>[0]) => cell.projector.project(point);

    const snapLines = (frame.snap?.lines ?? []).flatMap(([a, b]) => {
      const from = project(a);
      const to = project(b);
      return from && to ? [[from, to]] : [];
    });
    const snapAnchor = snapLines[0]?.[1] ?? leadLayout?.labelAt ?? null;

    let sweep: Pt[] | null = null;
    if (frame.sweep && Math.abs(frame.sweep.angle) > 1e-3) {
      const { center, axis, ref, radius, angle } = frame.sweep;
      const side = crossVec(axis, ref);
      const steps = Math.max(6, Math.ceil(Math.abs(angle) / (Math.PI / 48)));
      const points = [center];
      for (let index = 0; index <= steps; index += 1) {
        const t = (angle * index) / steps;
        points.push(addVec(center, addVec(scaleVec(ref, radius * Math.cos(t)), scaleVec(side, radius * Math.sin(t)))));
      }
      const projected = points.map(project);
      sweep = projected.every((point): point is Pt => point !== null) ? projected : null;
    }
    return {
      label: text && leadLayout ? { at: leadLayout.labelAt, ...text } : null,
      snapLines,
      snapLabel:
        frame.snap && snapAnchor ? { at: { x: snapAnchor.x + 8, y: snapAnchor.y - 12 }, text: frame.snap.label } : null,
      sweep,
    };
  }
}
