import type { Vec3, VirtualAxisId } from "../types";
import {
  angularRateOf,
  fitAngleToRange,
  headingRateOf,
  localTopCenter,
  parentUpOf,
  pointRateOf,
  poseWorldBox,
  worldPointOf,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import {
  addVec,
  closestLineParamToRay,
  crossVec,
  distancePt,
  distanceVec,
  dotVec,
  intersectRayPlane,
  rotateVec,
  scaleVec,
  subVec,
  wrapAngle,
  wrapDegrees,
  type Pt,
  type Ray,
} from "./pose-handle-math";
import { poseHandleModel, type RingHandleModel } from "./pose-handle-model";
import { placeRingModel, ringPoint, type CellProjector } from "./pose-handle-layout";
import { POSE_HANDLE_AXES, type PoseHandleAxisRange, type PoseHandleKind, type PoseHandleUpdate } from "./pose-handle-types";

/** 按住 Shift 细调：指针移动按这个比例算 */
export const FINE_DRAG_FACTOR = 0.1;
/** 离别的物体同高、同角度在这么多像素以内就吸过去 */
export const SNAP_PX = 8;
const TILT_SNAP_DEG = 1;
/** 摆动弧沿弧拖多少像素转 1 弧度（约 2.6 px / 度，±20° 约拖 50 px） */
export const ARC_DRAG_PX_PER_RAD = 150;
/** 偏转（倾斜方向）离别的物体同方向这么多度以内就吸过去 */
const HEADING_SNAP_DEG = 2;

/** 一起拖的一台物体：拖动开始时的运动学 */
export type DragMember = {
  objectId: string;
  input: PoseKinematics;
  ranges?: Partial<Record<VirtualAxisId, PoseHandleAxisRange>>;
};

/** 吸附候选：不在这次拖动里的物体 */
export type SnapCandidate = {
  objectId: string;
  /** 世界包围盒的底、顶（米） */
  bottom: number;
  top: number;
  center: Vec3;
  /** 朝前方向（旋转类同角度） */
  front?: Vec3 | null;
  /** 正在显示的虚轴值（倾斜同角度） */
  values?: { v1: number; v2: number; v3: number } | null;
  kinds?: readonly PoseHandleKind[];
};

export type SnapGuide = { label: string; lines: Array<[Vec3, Vec3]> };

/** 旋转、倾斜转过的扇形（世界） */
export type DragSweep = { center: Vec3; axis: Vec3; ref: Vec3; radius: number; angle: number };

export type DragFrame = {
  updates: PoseHandleUpdate[];
  snap: SnapGuide | null;
  sweep: DragSweep | null;
};

export type DragContext = {
  kind: PoseHandleKind;
  /** 按住的那台在最前 */
  members: readonly DragMember[];
  projector: CellProjector;
  rayAt: (point: Pt) => Ray | null;
  /** 按下的位置（画布坐标） */
  start: Pt;
  snapCandidates?: readonly SnapCandidate[];
};

export type PoseHandleDragSession = {
  kind: PoseHandleKind;
  update: (pointer: Pt, options: { fine: boolean }) => DragFrame | null;
};

/** 细调时指针移动打折：从切换那一刻起累计，不跳 */
const virtualPointer = (start: Pt) => {
  let last = start;
  let virtual = start;
  return (pointer: Pt, fine: boolean): Pt => {
    const factor = fine ? FINE_DRAG_FACTOR : 1;
    virtual = { x: virtual.x + (pointer.x - last.x) * factor, y: virtual.y + (pointer.y - last.y) * factor };
    last = pointer;
    return virtual;
  };
};

const metersPerPixel = (projector: CellProjector, point: Vec3): number =>
  1 / Math.max(projector.pixelsPerMeter(point), 1e-6);

/** 升降：同一段世界位移，每台按自己的正解换成虚轴 1 */
const createLiftSession = (context: DragContext): PoseHandleDragSession => {
  const { members, projector, rayAt, start } = context;
  const lead = members[0]!;
  const anchor = worldPointOf(lead.input, localTopCenter(lead.input.config));
  const up = parentUpOf(lead.input.parentWorld);
  const mpp = metersPerPixel(projector, anchor);
  const startRay = rayAt(start);
  const startParam = startRay ? closestLineParamToRay(startRay, anchor, up) : null;
  const endOn = startParam === null || Math.abs(dotVec(projector.viewDirection(anchor), up)) > 0.985;
  const rates = members.map((member) => pointRateOf(member.input, "v1", localTopCenter(member.input.config)));
  const leadBox = poseWorldBox(lead.input);
  const pointer = virtualPointer(start);
  let lastLift = 0;

  const snapLift = (lift: number): { lift: number; snap: SnapGuide } | null => {
    if (Math.abs(up.y) < 0.3) return null;
    const tolerance = SNAP_PX * mpp;
    let best: { gap: number; height: number; candidate: SnapCandidate; edge: "bottom" | "top" } | null = null;
    for (const candidate of context.snapCandidates ?? []) {
      for (const edge of ["bottom", "top"] as const) {
        const gap = candidate[edge] - (leadBox[edge] + lift * up.y);
        if (Math.abs(gap) > tolerance) continue;
        if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, height: candidate[edge], candidate, edge };
      }
    }
    if (!best) return null;
    const snapped = lift + best.gap / up.y;
    const mine = addVec(leadBox.center, scaleVec(up, snapped));
    return {
      lift: snapped,
      snap: {
        label: best.edge === "bottom" ? "底边同高" : "顶边同高",
        lines: [
          [
            { x: mine.x, y: best.height, z: mine.z },
            { x: best.candidate.center.x, y: best.height, z: best.candidate.center.z },
          ],
        ],
      },
    };
  };

  return {
    kind: "lift",
    update: (raw, { fine }) => {
      const at = pointer(raw, fine);
      let lift = lastLift;
      if (endOn) {
        lift = -(at.y - start.y) * mpp;
      } else {
        const ray = rayAt(at);
        const param = ray ? closestLineParamToRay(ray, anchor, up) : null;
        if (param !== null && startParam !== null) lift = param - startParam;
      }
      lastLift = lift;
      let snap: SnapGuide | null = null;
      if (!fine) {
        const snapped = snapLift(lift);
        if (snapped) {
          lift = snapped.lift;
          snap = snapped.snap;
        }
      }
      const displacement = scaleVec(up, lift);
      const updates = members.flatMap((member, index) => {
        const rate = rates[index]!;
        const rateSq = dotVec(rate, rate);
        if (rateSq < 1e-18) return [];
        // 同样的高度变化：沿竖直方向对上（多点摆升降时吊点平面还会稍微横移，不算进去）；
        // 升降方向和竖直差得多（挂在倾斜的物体上）时按位移在它升降方向上的分量
        const along = dotVec(rate, up);
        const delta =
          Math.abs(along) >= 0.5 * Math.sqrt(rateSq) ? lift / along : dotVec(displacement, rate) / rateSq;
        return [{ objectId: member.objectId, values: { v1: member.input.values.v1 + delta } }];
      });
      return { updates, snap, sweep: null };
    },
  };
};

/** 每台物体绕这根世界轴的转速（弧度 / 单位）；转轴大致反向时取反，不平行时只取大小 */
const ringRateOf = (kind: RingHandleModel["kind"], input: PoseKinematics, rotationAxis: Vec3): number | null => {
  // 偏转改的是倾斜方向：按方向绕竖直轴转多快算
  if (kind === "heading") return headingRateOf(input, rotationAxis);
  const rate = angularRateOf(input, POSE_HANDLE_AXES[kind][0]!);
  if (!rate) return null;
  const along = dotVec(rate.axis, rotationAxis);
  return Math.abs(along) >= 0.5 ? rate.rate * along : rate.rate * (along < 0 ? -1 : 1);
};

/** 旋转环 / 摆动弧 / 偏转环（都在升降箭头的位置）：同一个世界转角，每台按自己的正解换成这根轴 */
const createRingSession = (context: DragContext): PoseHandleDragSession | null => {
  const { kind, members, projector, rayAt, start } = context;
  const lead = members[0]!;
  const found = poseHandleModel(kind, lead.input);
  if (!found || found.kind === "lift") return null;
  const model: RingHandleModel = placeRingModel(found, projector);
  const { axis, center, rotationAxis, radius } = model;
  const e1 = model.ref;
  const e2 = crossVec(rotationAxis, model.ref);
  const angleOf = (point: Vec3) => {
    const offset = subVec(point, center);
    return Math.atan2(dotVec(offset, e2), dotVec(offset, e1));
  };

  // 视线和环面夹角太小（几乎侧着看）时在环面上取交点不稳，改成沿屏幕上环的切线方向拖
  // 整圈（旋转、偏转）像转盘一样跟着指针绕圆心转；摆动弧很小、行程也小，沿弧的方向按固定比例拖
  let previous: number | null = null;
  const facing = Math.abs(dotVec(projector.viewDirection(center), rotationAxis));
  if (!model.arc && facing > 0.2) {
    const ray = rayAt(start);
    const hit = ray ? intersectRayPlane(ray, center, rotationAxis) : null;
    if (hit) previous = angleOf(hit);
  }
  let tangent: Pt | null = null;
  if (previous === null) {
    const samples = Array.from({ length: 96 }, (_, index) => (index / 96) * Math.PI * 2);
    const screenTangent = (angle: number): Pt | null => {
      const delta = 0.02;
      const a = projector.project(ringPoint(model, radius, angle - delta));
      const b = projector.project(ringPoint(model, radius, angle + delta));
      return a && b ? { x: (b.x - a.x) / (2 * delta), y: (b.y - a.y) / (2 * delta) } : null;
    };
    let grab: { angle: number; distance: number } | null = null;
    for (const angle of samples) {
      const at = projector.project(ringPoint(model, radius, angle));
      if (!at) continue;
      const distance = distancePt(at, start);
      if (!grab || distance < grab.distance) grab = { angle, distance };
    }
    const radiusPx = radius * projector.pixelsPerMeter(center);
    tangent = grab ? screenTangent(grab.angle) : null;
    if (!tangent || Math.hypot(tangent.x, tangent.y) < 0.35 * radiusPx) {
      for (const angle of samples) {
        const candidate = screenTangent(angle);
        if (candidate && (!tangent || Math.hypot(candidate.x, candidate.y) > Math.hypot(tangent.x, tangent.y))) {
          tangent = candidate;
        }
      }
    }
    if (!tangent || Math.hypot(tangent.x, tangent.y) < 1e-6) return null;
  }

  const rates = members.map((member) => ringRateOf(kind as RingHandleModel["kind"], member.input, rotationAxis));
  const leadRate = rates[0];
  if (!leadRate) return null;

  const snapRing = (angle: number): { angle: number; snap: SnapGuide } | null => {
    if (kind === "yaw") {
      const tolerance = (SNAP_PX / Math.max(radius * projector.pixelsPerMeter(center), 1)) * 1.5;
      let best: { delta: number; candidate: SnapCandidate } | null = null;
      for (const candidate of context.snapCandidates ?? []) {
        if (!candidate.front || !candidate.kinds?.includes("yaw")) continue;
        const heading = Math.atan2(dotVec(candidate.front, e2), dotVec(candidate.front, e1));
        const delta = wrapAngle(heading - angle);
        if (Math.abs(delta) > tolerance) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, candidate };
      }
      if (!best) return null;
      const snapped = angle + best.delta;
      const reach = radius * 1.25;
      const direction = rotateVec(e1, rotationAxis, snapped);
      return {
        angle: snapped,
        snap: {
          label: "同角度",
          lines: [
            [center, addVec(center, scaleVec(direction, reach))],
            [best.candidate.center, addVec(best.candidate.center, scaleVec(direction, reach))],
          ],
        },
      };
    }
    const startValue = lead.input.values[axis];
    const value = startValue + angle / leadRate;
    // 摆动：吸到水平、别的物体同角度；偏转：吸到别的物体同方向（方向角按整圈比）
    const heading = kind === "heading";
    const targets: Array<{ value: number; label: string }> = heading ? [] : [{ value: 0, label: "水平" }];
    for (const candidate of context.snapCandidates ?? []) {
      if (candidate.values && candidate.kinds?.includes(kind)) {
        const other = candidate.values[axis];
        targets.push({
          value: heading ? value + wrapDegrees(other - value) : other,
          label: heading ? "同方向" : "同角度",
        });
      }
    }
    const tolerance = heading ? HEADING_SNAP_DEG : TILT_SNAP_DEG;
    let best: { value: number; label: string } | null = null;
    for (const target of targets) {
      if (Math.abs(target.value - value) > tolerance) continue;
      if (!best || Math.abs(target.value - value) < Math.abs(best.value - value)) best = target;
    }
    return best ? { angle: (best.value - startValue) * leadRate, snap: { label: best.label, lines: [] } } : null;
  };

  const pointer = virtualPointer(start);
  let accumulated = 0;
  return {
    kind,
    update: (raw, { fine }) => {
      const at = pointer(raw, fine);
      if (tangent) {
        const along = ((at.x - start.x) * tangent.x + (at.y - start.y) * tangent.y) / Math.hypot(tangent.x, tangent.y);
        accumulated = along / (model.arc ? ARC_DRAG_PX_PER_RAD : Math.hypot(tangent.x, tangent.y));
      } else {
        const ray = rayAt(at);
        const hit = ray ? intersectRayPlane(ray, center, rotationAxis) : null;
        if (hit && previous !== null && distanceVec(hit, center) > radius * 0.05) {
          const angle = angleOf(hit);
          accumulated += wrapAngle(angle - previous);
          previous = angle;
        }
      }
      let angle = accumulated;
      let snap: SnapGuide | null = null;
      if (!fine) {
        const snapped = snapRing(angle);
        if (snapped) {
          angle = snapped.angle;
          snap = snapped.snap;
        }
      }
      const updates = members.flatMap((member, index) => {
        const rate = rates[index];
        if (!rate) return [];
        const value = member.input.values[axis] + angle / rate;
        // 偏转是方向角：超出行程时换一圈
        return [
          {
            objectId: member.objectId,
            values: { [axis]: kind === "heading" ? fitAngleToRange(value, member.ranges?.[axis]) : value },
          },
        ];
      });
      return { updates, snap, sweep: { center, axis: rotationAxis, ref: e1, radius, angle } };
    },
  };
};

export const createPoseHandleDragSession = (context: DragContext): PoseHandleDragSession | null => {
  if (context.members.length === 0) return null;
  return context.kind === "lift" ? createLiftSession(context) : createRingSession(context);
};
