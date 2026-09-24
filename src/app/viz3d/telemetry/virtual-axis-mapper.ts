import {
  multiPointPlanarOffset,
  type Vec3 as PlcPoint,
} from "@/app/kinematics/multi-point-forward";
import type { ControlType } from "@/app/project/configuration-types";
import type {
  RuntimeTransform,
  SceneObjectConfig,
  Vec3,
  VirtualAxisKinematics,
  VirtualAxisValues,
} from "../types";
import {
  applyMat3,
  axisAngleMat3,
  IDENTITY_MAT3,
  mat3ToQuat,
  multiplyMat3,
  plcToSceneMat3,
  type Mat3,
} from "./mat3";

export const MM_TO_M = 0.001;
export const DEG_TO_RAD = Math.PI / 180;

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** 四点摆摆动 X：沿局部 +x；摆动 Y：PLC 以 0/1 号吊点（z<0）为正端，即沿局部 −z */
const SWING_X_DIR: Vec3 = { x: 1, y: 0, z: 0 };
const SWING_Y_DIR: Vec3 = { x: 0, y: 0, z: -1 };
const PLC_X: Vec3 = { x: 1, y: 0, z: 0 };
const PLC_Z: Vec3 = { x: 0, y: 0, z: 1 };

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v: Vec3, factor: number): Vec3 => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

type AxisValues = { v1: number; v2: number; v3: number };

/** 物体局部系：绕 pivot 旋转 rotation 后平移 shift；lift 为世界竖直位移（米） */
type KinematicPose = { lift: number; rotation: Mat3; pivot: Vec3; shift: Vec3 };

type PoseInput = { config: SceneObjectConfig; kinematics: VirtualAxisKinematics; values: AxisValues };

type PoseResolver = (input: PoseInput) => KinematicPose;

/** 方向 1：v1 为下放绳长（增大下降）；方向 2：v1 为上升高度（增大上升） */
const liftOf = ({ kinematics, values }: PoseInput): number =>
  (kinematics.runDirection === 2 ? values.v1 : -values.v1) * MM_TO_M;

/** 吊点贴物体顶面，PLC 绕吊点平面旋转 */
const hoistPlanePivot = (config: SceneObjectConfig, x: number, z: number): Vec3 => ({
  x,
  y: config.dimensions.h / 2,
  z,
});

const restPose = (): KinematicPose => ({ lift: 0, rotation: IDENTITY_MAT3, pivot: ZERO, shift: ZERO });

const liftPose: PoseResolver = (input) => ({ ...restPose(), lift: liftOf(input) });

/** 从上往下看顺时针为正；方向 2 反向 */
const rotationPose: PoseResolver = ({ kinematics, values }) => {
  const angleDeg = kinematics.runDirection === 2 ? -values.v1 : values.v1;
  return { ...restPose(), rotation: axisAngleMat3(UP, angleDeg * DEG_TO_RAD) };
};

/**
 * 两点/四点摆单向摆动（YXZ liangdian / sidian 正解）：θ>0 时 −u 端抬高 sinθ·half，
 * 吊点平面沿 u 滑移 ∓(θ/90)³·half（方向 2 PLC 对角度取反，滑移随之反号）。
 */
const planarSwing = (
  thetaDeg: number,
  u: Vec3,
  half: number,
  runDirection: 1 | 2,
): { rotation: Mat3; shift: Vec3 } => {
  const slideSign = runDirection === 2 ? 1 : -1;
  return {
    rotation: axisAngleMat3(cross(UP, u), thetaDeg * DEG_TO_RAD),
    shift: scale(u, slideSign * (thetaDeg / 90) ** 3 * half),
  };
};

const twoPointPose: PoseResolver = (input) => {
  const { config, kinematics, values } = input;
  const lift = liftOf(input);
  const [a, b] = config.hoistAxes ?? [];
  if (!a || !b) return { ...restPose(), lift };
  const dx = b.mount.x - a.mount.x;
  const dz = b.mount.z - a.mount.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return { ...restPose(), lift };
  const swing = planarSwing(
    values.v2,
    { x: dx / length, y: 0, z: dz / length },
    length / 2,
    kinematics.runDirection,
  );
  return {
    lift,
    rotation: swing.rotation,
    pivot: hoistPlanePivot(config, (a.mount.x + b.mount.x) / 2, (a.mount.z + b.mount.z) / 2),
    shift: swing.shift,
  };
};

const mountBounds = (config: SceneObjectConfig) => {
  const mounts = (config.hoistAxes ?? []).map((axis) => axis.mount);
  if (mounts.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  const xs = mounts.map((mount) => mount.x);
  const zs = mounts.map((mount) => mount.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
};

/** PLC 四点摆 X/Y 不同时摆动，组合顺序不影响结果 */
const fourPointPose: PoseResolver = (input) => {
  const { config, kinematics, values } = input;
  const bounds = mountBounds(config);
  const swingX = planarSwing(values.v2, SWING_X_DIR, (bounds.maxX - bounds.minX) / 2, kinematics.runDirection);
  const swingY = planarSwing(values.v3, SWING_Y_DIR, (bounds.maxZ - bounds.minZ) / 2, kinematics.runDirection);
  return {
    lift: liftOf(input),
    rotation: multiplyMat3(swingY.rotation, swingX.rotation),
    pivot: hoistPlanePivot(config, (bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2),
    shift: add(swingX.shift, swingY.shift),
  };
};

/**
 * 多点摆（YXZ duodian_forward_solution）：β = −(v3 + betainit)，α = −v2，
 * 吊点先绕 z 逆转 β、绕 x 转 α、再绕 z 顺转 β，即绕水平轴倾斜，v3 只决定倾斜方向；
 * 随后吊点平面沿 (sinβ, cosβ) 经验滑移。
 */
const multiPointPose: PoseResolver = (input) => {
  const { config, kinematics, values } = input;
  const beta = -(values.v3 + kinematics.betaInit);
  const angle = -values.v2;
  const rotationPlc = multiplyMat3(
    axisAngleMat3(PLC_Z, -beta * DEG_TO_RAD),
    multiplyMat3(axisAngleMat3(PLC_X, angle * DEG_TO_RAD), axisAngleMat3(PLC_Z, beta * DEG_TO_RAD)),
  );
  const pointsMm: PlcPoint[] = (config.hoistAxes ?? []).map((axis) => [
    axis.mount.x / MM_TO_M,
    axis.mount.z / MM_TO_M,
    0,
  ]);
  const heightTerm =
    kinematics.runDirection === 2
      ? kinematics.pulleyDistance + kinematics.maxHeight - values.v1
      : values.v1 + kinematics.pulleyDistance;
  const offsetM =
    pointsMm.length > 0 ? multiPointPlanarOffset(pointsMm, beta, angle, heightTerm) * MM_TO_M : 0;
  const betaRad = beta * DEG_TO_RAD;
  return {
    lift: liftOf(input),
    rotation: plcToSceneMat3(rotationPlc),
    pivot: hoistPlanePivot(config, 0, 0),
    shift: { x: Math.sin(betaRad) * offsetM, y: 0, z: Math.cos(betaRad) * offsetM },
  };
};

const POSE_BY_CONTROL_TYPE: Record<ControlType, PoseResolver> = {
  singlePointMove: liftPose,
  multiLevelHoist: liftPose,
  singlePointRotation: rotationPose,
  continuousRotation: rotationPose,
  twoPointSwing: twoPointPose,
  fourPointSwing: fourPointPose,
  dualTiltFourPointSwing: fourPointPose,
  multiPointSwing: multiPointPose,
  railCar: restPose,
  staticProp: restPose,
};

export const resolveVirtualAxisTransform = (
  base: SceneObjectConfig,
  values: VirtualAxisValues,
): RuntimeTransform => {
  const kinematics = base.kinematics;
  const pose = kinematics
    ? POSE_BY_CONTROL_TYPE[kinematics.controlType]({
        config: base,
        kinematics,
        values: { v1: values.v1 ?? 0, v2: values.v2 ?? 0, v3: values.v3 ?? 0 },
      })
    : restPose();
  return {
    position: { x: base.position.x, y: base.position.y + pose.lift, z: base.position.z },
    rotation: { ...ZERO },
    rotationQuaternion: mat3ToQuat(pose.rotation),
    pivotPosition: add(sub(pose.pivot, applyMat3(pose.rotation, pose.pivot)), pose.shift),
  };
};
