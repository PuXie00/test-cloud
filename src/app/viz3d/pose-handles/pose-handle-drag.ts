import type { Vec3, VirtualAxisId } from "../types";
import {
  angularRateOf,
  localTopCenter,
  parentUpOf,
  plateNormalOf,
  pointRateOf,
  poseWorldMatrix,
  solveSwingTowards,
  transformPoint,
  worldPointOf,
  type PoseKinematics,
} from "./pose-handle-kinematics";
import {
  addVec,
  angleBetween,
  closestLineParamToRay,
  closestRayParam,
  crossVec,
  distancePt,
  distanceVec,
  dotVec,
  intersectRayPlane,
  intersectRaySphere,
  normalizeVec,
  pointOnRay,
  rotateVec,
  scaleVec,
  subVec,
  wrapAngle,
  type Pt,
  type Ray,
} from "./pose-handle-math";
import { poseHandleModel, type RingHandleModel } from "./pose-handle-model";
import { ringPoint, ringRadiusIn, swingLengthIn, type CellProjector } from "./pose-handle-layout";
import type { PoseHandleAxisRange, PoseHandleKind, PoseHandleUpdate } from "./pose-handle-types";

/** 按住 Shift 细调：指针移动按这个比例算 */
export const FINE_DRAG_FACTOR = 0.1;
/** 离别的物体同高、同角度在这么多像素以内就吸过去 */
export const SNAP_PX = 8;
const TILT_SNAP_DEG = 1;
const SWING_LEVEL_SNAP_RAD = (1.5 * Math.PI) / 180;

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

type WorldBox = { bottom: number; top: number; center: Vec3 };

/** 物体尺寸盒在世界里的上下沿（按运动学，不看显示的是本体还是影子） */
const worldBoxOf = (input: PoseKinematics): WorldBox => {
  const frame = poseWorldMatrix(input);
  const { w, h, d } = input.config.dimensions;
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = transformPoint(frame, { x: (sx * w) / 2, y: (sy * h) / 2, z: (sz * d) / 2 });
        bottom = Math.min(bottom, corner.y);
        top = Math.max(top, corner.y);
      }
    }
  }
  return { bottom, top, center: transformPoint(frame, { x: 0, y: 0, z: 0 }) };
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
  const leadBox = worldBoxOf(lead.input);
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

/** 旋转环 / 倾斜弧：同一个世界转角，每台按自己的正解换成这根轴 */
const createRingSession = (context: DragContext): PoseHandleDragSession | null => {
  const { kind, members, projector, rayAt, start } = context;
  const lead = members[0]!;
  const found = poseHandleModel(kind, lead.input);
  if (!found || found.kind === "lift" || found.kind === "swing") return null;
  const model: RingHandleModel = found;
  const { axis, center, rotationAxis } = model;
  const radius = ringRadiusIn(model, projector);
  const e1 = model.ref;
  const e2 = crossVec(rotationAxis, model.ref);
  const angleOf = (point: Vec3) => {
    const offset = subVec(point, center);
    return Math.atan2(dotVec(offset, e2), dotVec(offset, e1));
  };

  // 视线和环面夹角太小（几乎侧着看）时在环面上取交点不稳，改成沿屏幕上环的切线方向拖
  let previous: number | null = null;
  const facing = Math.abs(dotVec(projector.viewDirection(center), rotationAxis));
  if (facing > 0.2) {
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

  // 每台物体绕这根世界轴的转速（弧度 / 单位）；转轴大致反向时取反，不平行时只取大小
  const rates = members.map((member) => {
    const rate = angularRateOf(member.input, axis);
    if (!rate) return null;
    const along = dotVec(rate.axis, rotationAxis);
    return Math.abs(along) >= 0.5 ? rate.rate * along : rate.rate * (along < 0 ? -1 : 1);
  });
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
    const targets: Array<{ value: number; label: string }> = [{ value: 0, label: "水平" }];
    for (const candidate of context.snapCandidates ?? []) {
      if (candidate.values && candidate.kinds?.includes(kind)) {
        targets.push({ value: candidate.values[axis], label: "同角度" });
      }
    }
    let best: { value: number; label: string } | null = null;
    for (const target of targets) {
      if (Math.abs(target.value - value) > TILT_SNAP_DEG) continue;
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
        accumulated = ((at.x - start.x) * tangent.x + (at.y - start.y) * tangent.y) / (tangent.x ** 2 + tangent.y ** 2);
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
        return [{ objectId: member.objectId, values: { [axis]: member.input.values[axis] + angle / rate } }];
      });
      return { updates, snap, sweep: { center, axis: rotationAxis, ref: e1, radius, angle } };
    },
  };
};

/** 摇杆：杆头在以吊点平面中心为心的球面上跟着指针走；别的物体按同一个世界转动换算 */
const createSwingSession = (context: DragContext): PoseHandleDragSession | null => {
  const { members, projector, rayAt, start } = context;
  const lead = members[0]!;
  const model = poseHandleModel("swing", lead.input);
  if (!model || model.kind !== "swing") return null;
  const { center, up } = model;
  const startNormal = model.normal;
  const length = swingLengthIn(model, projector);
  const starts = members.map((member) => plateNormalOf(member.input));
  const pointer = virtualPointer(start);
  let previousKnob = addVec(center, scaleVec(startNormal, length));

  return {
    kind: "swing",
    update: (raw, { fine }) => {
      const ray = rayAt(pointer(raw, fine));
      if (!ray) return null;
      const hits = intersectRaySphere(ray, center, length);
      let knob: Vec3;
      if (hits) {
        knob = distanceVec(hits[0], previousKnob) <= distanceVec(hits[1], previousKnob) ? hits[0] : hits[1];
      } else {
        const closest = pointOnRay(ray, Math.max(0, closestRayParam(ray, center)));
        const direction = normalizeVec(subVec(closest, center));
        if (!direction) return null;
        knob = addVec(center, scaleVec(direction, length));
      }
      previousKnob = knob;
      let normal = normalizeVec(subVec(knob, center));
      if (!normal) return null;
      let snap: SnapGuide | null = null;
      if (!fine && angleBetween(normal, up) < SWING_LEVEL_SNAP_RAD) {
        normal = up;
        snap = { label: "水平", lines: [] };
      }
      const rotationAxis = normalizeVec(crossVec(startNormal, normal));
      const angle = angleBetween(startNormal, normal);
      const updates = members.map((member, index) => {
        const target = rotationAxis && angle > 1e-9 ? rotateVec(starts[index]!, rotationAxis, angle) : starts[index]!;
        const solved = solveSwingTowards(member.input, target, { v2: member.ranges?.v2, v3: member.ranges?.v3 });
        return { objectId: member.objectId, values: { v2: solved.v2, v3: solved.v3 } };
      });
      return { updates, snap, sweep: null };
    },
  };
};

export const createPoseHandleDragSession = (context: DragContext): PoseHandleDragSession | null => {
  if (context.members.length === 0) return null;
  switch (context.kind) {
    case "lift":
      return createLiftSession(context);
    case "swing":
      return createSwingSession(context);
    default:
      return createRingSession(context);
  }
};
