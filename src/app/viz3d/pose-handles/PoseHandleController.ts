import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import { attachmentFrameMatrix } from "../state/preview-path-points";
import type { SceneObjectConfig, SlotRect, ViewportCellId, VirtualAxisId } from "../types";
import {
  motionPathWorld,
  motionRangeOf,
  type MotionPathWorld,
  type MotionRangeBounds,
  type ParentFrameAt,
} from "./motion-path-geometry";
import { hitTestMotionPaths, layoutMotionPath, type MotionPathHit, type MotionPathLayout } from "./motion-path-layout";
import type { MotionPathEntry, MotionPathPickEvent, MotionPathSample } from "./motion-path-types";
import type { MotionPathOverlay } from "./MotionPathOverlay";
import {
  createPoseHandleDragSession,
  type DragFrame,
  type DragMember,
  type PoseHandleDragSession,
  type SnapCandidate,
} from "./pose-handle-drag";
import {
  localTopCenter,
  parentUpOf,
  poseWorldBox,
  toFullAxisValues,
  worldPointOf,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import {
  edgeHeightOf,
  formationSpread,
  solveFormation,
  type FormationEdge,
  type FormationTarget,
  type PoseFormationBlocked,
  type PoseFormationEvent,
  type PoseFormationInfo,
  type PoseFormationRequest,
} from "./pose-formation";
import {
  handleSpotOf,
  hitTestHandles,
  layoutPoseHandle,
  poseHandleKey,
  type CellProjector,
  type HandleLayout,
} from "./pose-handle-layout";
import { addVec, crossVec, distancePt, scaleVec, type Pt, type Ray } from "./pose-handle-math";
import { poseHandleModel, type PoseHandleModel } from "./pose-handle-model";
import type { OverlayCell, OverlayDrag, OverlayHandle, OverlaySwitchChip, PoseHandleOverlay } from "./PoseHandleOverlay";
import {
  POSE_HANDLE_AXES,
  poseHandleAxisOf,
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
  /** 挂载的父物体 id（画挂载子物体的轨迹时叠加父物体那一刻的姿态） */
  getMountParentId?: (objectId: string) => string | null;
  /** 点了轨迹上的位姿点或轨迹线 */
  onPathPick?: (event: MotionPathPickEvent) => void;
};

/** 按住手柄后移动这么多像素才算开始拖：只点一下不改位姿 */
export const POSE_HANDLE_DRAG_START_PX = 3;
/** 点轨迹时按下到抬起移动超过这么多就不算点 */
const PATH_PICK_SLOP_PX = 4;

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** 手柄旁的虚轴切换：一格一格竖着排在手柄左边 */
const SWITCH_CHIP_WIDTH_PX = 58;
const SWITCH_CHIP_HEIGHT_PX = 18;
const SWITCH_CHIP_GAP_PX = 3;
/** 切换条离手柄中心多远（让开环、弧） */
const SWITCH_OFFSET_PX = 36;

const AXIS_NUMBER: Record<VirtualAxisId, number> = { v1: 1, v2: 2, v3: 3 };

/** 这台物体有哪几根虚轴的手柄（按 1、2、3） */
const axesOf = (target: PoseHandleTarget): VirtualAxisId[] =>
  [...new Set(target.kinds.map(poseHandleAxisOf))].sort((left, right) => AXIS_NUMBER[left] - AXIS_NUMBER[right]);

type PendingPick = { pointerId: number; start: Pt; hit: MotionPathHit };

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
  private paths: MotionPathEntry[] = [];
  /** 轨迹的世界形状：轨迹变了才重算（挂载的物体还没加载时下一帧再算） */
  private pathWorlds: MotionPathWorld[] | null = null;
  private readonly pathLayouts = new Map<ViewportCellId, MotionPathLayout[]>();
  private pendingPick: PendingPick | null = null;
  private pathHover: { cellId: ViewportCellId; hit: MotionPathHit } | null = null;
  private cursor: string | null = null;
  /** 现在出哪根虚轴的手柄：每台只出一个，没有这根轴的出它的第一个 */
  private activeAxis: VirtualAxisId = "v1";
  private readonly switchers = new Map<ViewportCellId, OverlaySwitchChip[]>();
  private switchHover: { cellId: ViewportCellId; axis: VirtualAxisId } | null = null;
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finish(true);
  };

  constructor(
    private readonly host: PoseHandleHost,
    private readonly overlay: PoseHandleOverlay | null,
    private readonly pathOverlay: MotionPathOverlay | null = null,
  ) {}

  /** 动作页 3D 轨迹：选中物体（或全部）的整条动作 */
  setMotionPaths(entries: readonly MotionPathEntry[]): void {
    this.paths = [...entries];
    this.pathWorlds = null;
    if (this.paths.length === 0) {
      this.pendingPick = null;
      this.pathHover = null;
      this.syncCursor();
    }
  }

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

  getActiveAxis(): VirtualAxisId {
    return this.activeAxis;
  }

  /** 切到这根虚轴的手柄；拖动中或手柄里都没有这根轴时不切，返回 false */
  setActiveAxis(axis: VirtualAxisId): boolean {
    if (this.drag) return false;
    if (!this.targets.some((target) => target.kinds.some((kind) => poseHandleAxisOf(kind) === axis))) return false;
    this.activeAxis = axis;
    this.pending = null;
    this.setHovered(null);
    return true;
  }

  /** 每帧调用 */
  render(): void {
    this.layouts.clear();
    this.pathLayouts.clear();
    const hasHandles = this.targets.length > 0 || this.drag !== null;
    if (!hasHandles && this.paths.length === 0) {
      // 别的页面每帧都走这里：没画过就什么都不做
      if (this.shown) {
        const cells = this.host.getCells();
        this.overlay?.render(
          cells.map((cell) => ({ id: cell.id, rect: cell.rect, handles: [], drag: null, switcher: [] })),
        );
        this.pathOverlay?.render(cells.map((cell) => ({ id: cell.id, rect: cell.rect, paths: [], hover: null })));
      }
      this.shown = false;
      return;
    }
    const cells = this.host.getCells();
    this.renderPaths(cells);
    const models = this.models();
    this.switchers.clear();
    const overlayCells: OverlayCell[] = cells.map((cell) => {
      const layouts = models.flatMap(({ target, model }) => {
        const layout = layoutPoseHandle(target.objectId, model, cell.projector);
        return layout ? [layout] : [];
      });
      this.layouts.set(cell.id, layouts);
      const switcher = this.layoutSwitcher(cell);
      this.switchers.set(cell.id, switcher);
      return {
        id: cell.id,
        rect: cell.rect,
        handles: layouts.map((layout) => this.overlayHandle(layout)),
        drag: this.overlayDrag(cell, layouts),
        switcher,
      };
    });
    this.overlay?.render(overlayCells);
    this.shown = true;
  }

  /**
   * 按在手柄上时返回 true（这次按下归手柄，不框选）；拖不了的手柄也返回 true 并提示原因。
   * 没按在手柄上、按在轨迹的位姿点或选中物体的轨迹线上，也返回 true，抬起时算点了轨迹。
   */
  pointerDown(point: Pt, pointerId: number): boolean {
    if (this.drag) return false;
    const cell = this.host.getCells().find((entry) => rectContains(entry.rect, point));
    if (!cell) return false;
    const chip = this.switchChipAt(cell.id, point);
    if (chip) {
      // 手柄旁的切换：换成这根虚轴的手柄
      this.setActiveAxis(chip.axis);
      return true;
    }
    const hit = hitTestHandles(this.layouts.get(cell.id) ?? [], point);
    const target = hit ? this.targetOf(hit.layout.objectId) : undefined;
    if (hit && target) {
      if (target.blockedReason) {
        this.host.onBlocked({ objectId: target.objectId, reason: target.blockedReason });
        return true;
      }
      this.pending = { pointerId, start: point, cellId: cell.id, objectId: target.objectId, kind: hit.layout.kind };
      return true;
    }
    const pathHit = hitTestMotionPaths(this.pathLayouts.get(cell.id) ?? [], point);
    if (!pathHit) return false;
    this.pendingPick = { pointerId, start: point, hit: pathHit };
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
    if (this.pendingPick) {
      if (this.pendingPick.pointerId === pointerId && distancePt(point, this.pendingPick.start) > PATH_PICK_SLOP_PX) {
        this.pendingPick = null;
      }
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
    if (this.pendingPick) {
      const { hit, pointerId: pickPointer } = this.pendingPick;
      if (pickPointer !== pointerId) return true;
      this.pendingPick = null;
      this.host.onPathPick?.(
        hit.kind === "keyframe"
          ? { kind: "keyframe", objectId: hit.objectId, blockId: hit.blockId, atMs: hit.atMs }
          : { kind: "time", objectId: hit.objectId, atMs: hit.atMs, segmentKey: hit.segmentKey },
      );
      return true;
    }
    return false;
  }

  /** 放弃拖动：位姿回到按下前 */
  cancel(): boolean {
    this.pending = null;
    this.pendingPick = null;
    if (!this.drag) return false;
    this.finish(true);
    return true;
  }

  hover(point: Pt | null): void {
    if (this.drag) return;
    const cell = point ? this.host.getCells().find((entry) => rectContains(entry.rect, point)) : undefined;
    const chip = cell && point ? this.switchChipAt(cell.id, point) : null;
    this.switchHover = chip && cell ? { cellId: cell.id, axis: chip.axis } : null;
    const hit = cell && point && !chip ? hitTestHandles(this.layouts.get(cell.id) ?? [], point) : null;
    const target = hit ? this.targetOf(hit.layout.objectId) : undefined;
    this.setHovered(hit && target ? { key: hit.layout.key, blocked: Boolean(target.blockedReason) } : null);
    // 手柄优先；不在手柄上时看轨迹
    const pathHit =
      !this.hovered && !chip && cell && point ? hitTestMotionPaths(this.pathLayouts.get(cell.id) ?? [], point) : null;
    this.pathHover = pathHit && cell ? { cellId: cell.id, hit: pathHit } : null;
    this.syncCursor();
  }

  dispose(): void {
    if (this.drag) this.finish(true);
    this.pending = null;
    this.pendingPick = null;
    window.removeEventListener("keydown", this.handleKeyDown, true);
  }

  private renderPaths(cells: readonly PoseHandleHostCell[]): void {
    const worlds = this.paths.length > 0 ? this.resolvePathWorlds() : [];
    this.pathOverlay?.render(
      cells.map((cell) => {
        const layouts = worlds.map((world) => layoutMotionPath(world, cell.projector));
        this.pathLayouts.set(cell.id, layouts);
        const hover = this.pathHover?.cellId === cell.id ? this.pathHover.hit : null;
        return {
          id: cell.id,
          rect: cell.rect,
          paths: layouts,
          hover: hover
            ? {
                at: hover.at,
                text:
                  hover.kind === "time" && hover.segmentKey
                    ? `${formatSeconds(hover.atMs)} · 这段有问题`
                    : formatSeconds(hover.atMs),
                warning: hover.kind === "time" && hover.segmentKey !== null,
              }
            : null,
        };
      }),
    );
  }

  /**
   * 挂载子物体叠加父物体的姿态：父物体也有取样时按它那一刻的样子，否则按它现在的样子
   * （samples 按物体、时刻查虚轴值）
   */
  private parentFramesOf(
    objectId: string,
    samples: ReadonlyMap<string, ReadonlyMap<number, MotionPathSample["values"]>>,
    depth = 0,
  ): ParentFrameAt {
    const parentId = this.host.getMountParentId?.(objectId) ?? null;
    if (!parentId) return () => null;
    const parentConfig = this.host.getConfig(parentId);
    const parentSamples = samples.get(parentId);
    const above = depth < 8 ? this.parentFramesOf(parentId, samples, depth + 1) : () => null;
    let current: Matrix | null | undefined;
    return (atMs) => {
      const values = atMs === null ? undefined : parentSamples?.get(atMs);
      if (!values || !parentConfig) {
        if (current === undefined) current = this.host.getParentWorld(objectId, false);
        return current;
      }
      const frame = attachmentFrameMatrix(parentConfig, values);
      const grand = above(atMs);
      return grand ? frame.multiply(grand) : frame;
    };
  }

  /** 轨迹的世界形状：挂载子物体的轨迹叠加父物体 */
  private resolvePathWorlds(): MotionPathWorld[] {
    if (this.pathWorlds) return this.pathWorlds;
    const samples = new Map(
      this.paths.map((entry) => [entry.objectId, new Map(entry.samples.map((sample) => [sample.atMs, sample.values]))]),
    );
    let complete = true;
    const worlds = this.paths.flatMap((entry) => {
      const config = this.host.getConfig(entry.objectId);
      if (!config) {
        complete = false;
        return [];
      }
      const world = motionPathWorld(entry, config, this.parentFramesOf(entry.objectId, samples));
      return world ? [world] : [];
    });
    if (complete) this.pathWorlds = worlds;
    return worlds;
  }

  /**
   * 这些物体整段动作扫过的范围（每个取样时尺寸盒的角，世界坐标、米）：「看全这台的动作」用。
   * samples 里也可以放父物体的取样，挂载子物体按父物体那一刻的姿态叠加。
   */
  motionRangeBounds(
    objectIds: readonly string[],
    samples: ReadonlyMap<string, readonly MotionPathSample[]>,
  ): MotionRangeBounds | null {
    const lookup = new Map(
      [...samples].map(([objectId, list]) => [objectId, new Map(list.map((sample) => [sample.atMs, sample.values]))]),
    );
    let bounds: MotionRangeBounds | null = null;
    for (const objectId of objectIds) {
      const config = this.host.getConfig(objectId);
      const list = samples.get(objectId);
      if (!config || !list) continue;
      const range = motionRangeOf(list, config, this.parentFramesOf(objectId, lookup));
      if (!range) continue;
      bounds = bounds
        ? {
            min: {
              x: Math.min(bounds.min.x, range.min.x),
              y: Math.min(bounds.min.y, range.min.y),
              z: Math.min(bounds.min.z, range.min.z),
            },
            max: {
              x: Math.max(bounds.max.x, range.max.x),
              y: Math.max(bounds.max.y, range.max.y),
              z: Math.max(bounds.max.z, range.max.z),
            },
          }
        : range;
    }
    return bounds;
  }

  /** 队形：能升降、拖得了的手柄物体（按选中顺序），和拖不了的及原因 */
  private formationMembers(): { members: DragMember[]; blocked: PoseFormationBlocked[] } {
    const members: DragMember[] = [];
    const blocked: PoseFormationBlocked[] = [];
    for (const target of this.targets) {
      if (!target.kinds.includes("lift")) continue;
      if (target.blockedReason) {
        blocked.push({ objectId: target.objectId, reason: target.blockedReason });
        continue;
      }
      const input = this.kinematicsOf(target);
      if (input) members.push({ objectId: target.objectId, input, ranges: target.ranges });
    }
    return { members, blocked };
  }

  /**
   * 对齐的参照高度（米）：参照有手柄时按它手柄的值（3D 显示的那一刻）算尺寸盒，
   * 否则（静止道具等）按 3D 里显示的包围盒；跟着要动的物体一起动的参照不算
   */
  private referenceHeight(referenceId: string, edge: FormationEdge, members: readonly DragMember[]): number | null {
    const target = this.targetOf(referenceId);
    const input = target ? this.kinematicsOf(target) : null;
    if (input) return edgeHeightOf(poseWorldBox(input), edge);
    const moving = new Set(members.map((member) => member.objectId));
    const candidate = this.host.getSnapCandidates(moving).find((entry) => entry.objectId === referenceId);
    if (!candidate) return null;
    return edge === "bottom" ? candidate.bottom : edge === "top" ? candidate.top : candidate.center.y;
  }

  /** 右键菜单里队形工具能不能用：参与的物体、高低差、对齐参照 */
  formationInfo(referenceId: string | null): PoseFormationInfo {
    const { members, blocked } = this.formationMembers();
    const others = members.filter((member) => member.objectId !== referenceId);
    return {
      memberIds: members.map((member) => member.objectId),
      blocked,
      spread: formationSpread(members),
      canAlign:
        referenceId !== null && others.length > 0 && this.referenceHeight(referenceId, "bottom", members) !== null,
    };
  }

  /** 算出队形要写的虚轴 1（同手柄拖动的写法）；拖动中或用不了时 null */
  planFormation(request: PoseFormationRequest): PoseFormationEvent | null {
    if (this.drag) return null;
    const { members, blocked } = this.formationMembers();
    let moving: DragMember[] = members;
    let target: FormationTarget;
    if (request.kind === "align") {
      const height = this.referenceHeight(request.referenceId, request.edge, members);
      if (height === null) return null;
      moving = members.filter((member) => member.objectId !== request.referenceId);
      target = { kind: "align", edge: request.edge, height };
    } else {
      if (members.length < 2) return null;
      target = { kind: "scale", factor: request.factor };
    }
    if (moving.length === 0) return null;
    const referenceId = request.kind === "align" ? request.referenceId : null;
    return {
      request,
      ...solveFormation(moving, target),
      blocked: blocked.filter((entry) => entry.objectId !== referenceId),
    };
  }

  /** 光标：拖动中、手柄上、轨迹上各不相同 */
  private syncCursor(): void {
    const next = this.drag
      ? "grabbing"
      : this.hovered
        ? this.hovered.blocked
          ? "not-allowed"
          : "grab"
        : this.pathHover || this.switchHover
          ? "pointer"
          : null;
    if (next === this.cursor) return;
    this.cursor = next;
    this.host.setCursor(next);
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

  /** 这台物体现在出的手柄：当前虚轴的，没有这根轴时出它的第一个 */
  private activeKindOf(target: PoseHandleTarget): PoseHandleKind | undefined {
    return target.kinds.find((kind) => poseHandleAxisOf(kind) === this.activeAxis) ?? target.kinds[0];
  }

  private models(): Array<{ target: PoseHandleTarget; model: PoseHandleModel }> {
    return this.targets.flatMap((target) => {
      const kind = this.activeKindOf(target);
      const input = this.kinematicsOf(target);
      if (!kind || !input) return [];
      const model = poseHandleModel(kind, input, target.ranges);
      return model ? [{ target, model }] : [];
    });
  }

  /**
   * 手柄旁的虚轴切换：第一台有几根轴可切的物体旁边竖着排「1 升降 / 2 摆动 X / 3 …」，
   * 拖动时收起
   */
  private layoutSwitcher(cell: PoseHandleHostCell): OverlaySwitchChip[] {
    if (this.drag) return [];
    const target = this.targets.find((entry) => axesOf(entry).length > 1);
    const input = target ? this.kinematicsOf(target) : null;
    if (!target || !input) return [];
    const anchor = worldPointOf(input, localTopCenter(input.config));
    const spot = cell.projector.project(handleSpotOf(anchor, parentUpOf(input.parentWorld), cell.projector));
    if (!spot) return [];
    const axes = axesOf(target);
    const shownAxis = poseHandleAxisOf(this.activeKindOf(target)!);
    const total = axes.length * SWITCH_CHIP_HEIGHT_PX + (axes.length - 1) * SWITCH_CHIP_GAP_PX;
    const left = spot.x - SWITCH_OFFSET_PX - SWITCH_CHIP_WIDTH_PX;
    return axes.map((axis, index) => ({
      axis,
      text: `${AXIS_NUMBER[axis]} ${target.axisLabels?.[axis] ?? `虚轴 ${AXIS_NUMBER[axis]}`}`,
      active: axis === shownAxis,
      hover: this.switchHover?.cellId === cell.id && this.switchHover.axis === axis,
      rect: {
        left,
        top: spot.y - total / 2 + index * (SWITCH_CHIP_HEIGHT_PX + SWITCH_CHIP_GAP_PX),
        width: SWITCH_CHIP_WIDTH_PX,
        height: SWITCH_CHIP_HEIGHT_PX,
      },
    }));
  }

  private switchChipAt(cellId: ViewportCellId, point: Pt): OverlaySwitchChip | null {
    return (this.switchers.get(cellId) ?? []).find((chip) => rectContains(chip.rect, point)) ?? null;
  }

  private setHovered(next: { key: string; blocked: boolean } | null): void {
    if (this.hovered?.key === next?.key && this.hovered?.blocked === next?.blocked) return;
    this.hovered = next;
    this.syncCursor();
  }

  private begin(pending: Pending): boolean {
    const cell = this.host.getCells().find((entry) => entry.id === pending.cellId);
    const lead = this.targetOf(pending.objectId);
    if (!cell || !lead) return false;
    // 出着同一种手柄的选中物体一起动（升降和旋转不混）；拖不了的不带
    const group = [
      lead,
      ...this.targets.filter(
        (target) => target !== lead && !target.blockedReason && this.activeKindOf(target) === pending.kind,
      ),
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
    this.syncCursor();
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
    this.syncCursor();
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
