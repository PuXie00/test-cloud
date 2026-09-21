import { solveMultiPointForward, type Vec3 } from "@/app/kinematics/multi-point-forward";

/** 0.1 s motor-length / analytic-velocity samples, matching the Python planner. */
export const INITIAL_TRANSITION_SAMPLE_DT = 0.1;

/** Extra slowdown when sampled motor speed exceeds the limit. */
export const OVERSPEED_SAFETY_FACTOR = 1.01;

const DEG_TO_RAD = Math.PI / 180;
const AXIS_H = 0;
const AXIS_P = 1;
const AXIS_Y = 2;

export type HoistPointCount = 1 | 2 | 4 | 8;

export type AxisVad = {
  velocity: number;
  acceleration: number;
  deceleration: number;
};

export type HpyPose = {
  h: number;
  p: number;
  y: number;
};

type SharedMotionInput = {
  id?: number;
  current: HpyPose;
  target: HpyPose;
  h: AxisVad;
  p: AxisVad;
  y: AxisVad;
  maxMotorVelocity: number;
};

export type SinglePointTransitionInput = SharedMotionInput & {
  type: 1;
  motorCount?: number;
};

export type TwoPointTransitionInput = SharedMotionInput & {
  type: 2;
  baseHeight1: number;
  baseHeight2: number;
  lengthInside: number;
  maxHeight: number;
};

export type FourPointTransitionInput = SharedMotionInput & {
  type: 4;
  baseHeight1: number;
  baseHeight2: number;
  lengthInside: number;
  widthInside: number;
  maxHeight: number;
  moveWhat: number;
};

export type MultiPointTransitionInput = SharedMotionInput & {
  type: 8;
  baseHeight1: number;
  baseHeight2: number;
  maxHeight: number;
  betaInit: number;
  pointInitPos: readonly Vec3[];
};

export type InitialTransitionModelInput =
  | SinglePointTransitionInput
  | TwoPointTransitionInput
  | FourPointTransitionInput
  | MultiPointTransitionInput;

export type InitialTransitionModelResult = {
  id?: number;
  type: HoistPointCount;
  time: number;
  H: AxisVad;
  P: AxisVad;
  Y: AxisVad;
  finalMaxVelocity: number;
  maxMotorVelocity: number;
  velocityCheck: boolean;
};

export type InitialTransitionPlan = {
  totalTime: number;
  models: InitialTransitionModelResult[];
};

export type TwoPointForwardInput = {
  height: number;
  pitch: number;
  baseHeight1: number;
  baseHeight2: number;
  lengthInside: number;
  maxHeight: number;
};

export type FourPointForwardInput = {
  height: number;
  pitch: number;
  yaw: number;
  baseHeight1: number;
  baseHeight2: number;
  lengthInside: number;
  widthInside: number;
  maxHeight: number;
  moveWhat: number;
};

type HangKind = "upper" | "lower";

type AxisProfile = {
  p0: number;
  pf: number;
  direction: number;
  peakVelocity: number;
  accelTime: number;
  cruiseTime: number;
  decelTime: number;
  totalTime: number;
};

type TwoPointFrame = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  xA: number;
  yA: number;
  xB: number;
  yB: number;
  xAVel: number;
  yAVel: number;
  xBVel: number;
  yBVel: number;
};

type WorkingModel = {
  input: InitialTransitionModelInput;
  vad: [AxisVad, AxisVad, AxisVad];
  axisTime: [number, number, number];
  modelTime: number;
  safeTime: number;
};

const cloneVad = (axis: AxisVad): AxisVad => ({
  velocity: axis.velocity,
  acceleration: axis.acceleration,
  deceleration: axis.deceleration,
});

const poseComponent = (pose: HpyPose, axis: number): number => {
  if (axis === AXIS_H) return pose.h;
  if (axis === AXIS_P) return pose.p;
  return pose.y;
};

const hangKind = (baseHeight1: number, baseHeight2: number): HangKind | null => {
  if (baseHeight1 !== 0 && baseHeight2 === 0) return "upper";
  if (baseHeight1 === 0 && baseHeight2 !== 0) return "lower";
  return null;
};

const idleProfile = (p0: number, pf: number): AxisProfile => ({
  p0,
  pf,
  direction: 0,
  peakVelocity: 0,
  accelTime: 0,
  cruiseTime: 0,
  decelTime: 0,
  totalTime: 0,
});

const buildProfile = (
  p0: number,
  pf: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
): AxisProfile => {
  const distance = Math.abs(pf - p0);
  if (distance === 0) return idleProfile(p0, pf);
  if (velocity <= 0 || acceleration <= 0 || deceleration <= 0) {
    throw new Error("velocity, acceleration, and deceleration must be greater than 0");
  }
  const direction = pf > p0 ? 1 : -1;
  const accelDistance = velocity ** 2 / (2 * acceleration);
  const decelDistance = velocity ** 2 / (2 * deceleration);
  if (distance >= accelDistance + decelDistance) {
    const peakVelocity = velocity;
    const accelTime = peakVelocity / acceleration;
    const cruiseTime = (distance - accelDistance - decelDistance) / peakVelocity;
    const decelTime = peakVelocity / deceleration;
    return {
      p0,
      pf,
      direction,
      peakVelocity,
      accelTime,
      cruiseTime,
      decelTime,
      totalTime: accelTime + cruiseTime + decelTime,
    };
  }
  const peakVelocity = Math.sqrt(
    (2 * distance * acceleration * deceleration) / (acceleration + deceleration),
  );
  const accelTime = peakVelocity / acceleration;
  const cruiseTime = 0;
  const decelTime = peakVelocity / deceleration;
  return {
    p0,
    pf,
    direction,
    peakVelocity,
    accelTime,
    cruiseTime,
    decelTime,
    totalTime: accelTime + cruiseTime + decelTime,
  };
};

const calcMotionTime = (
  current: number,
  target: number,
  velocity: number,
  acceleration: number,
  deceleration: number,
): number => buildProfile(current, target, velocity, acceleration, deceleration).totalTime;

const positionVelocityAt = (
  profile: AxisProfile,
  time: number,
  acceleration: number,
  deceleration: number,
): { position: number; velocity: number } => {
  const { p0, pf, direction, peakVelocity, accelTime, cruiseTime, totalTime } = profile;
  if (direction === 0 || time <= 0) return { position: p0, velocity: 0 };
  if (time >= totalTime) return { position: pf, velocity: 0 };
  if (time <= accelTime) {
    const travel = 0.5 * acceleration * time ** 2;
    return { position: p0 + direction * travel, velocity: direction * acceleration * time };
  }
  if (time <= accelTime + cruiseTime) {
    const dt = time - accelTime;
    const travel = 0.5 * acceleration * accelTime ** 2 + peakVelocity * dt;
    return { position: p0 + direction * travel, velocity: direction * peakVelocity };
  }
  const dt = time - accelTime - cruiseTime;
  const travel =
    0.5 * acceleration * accelTime ** 2 +
    peakVelocity * cruiseTime +
    peakVelocity * dt -
    0.5 * deceleration * dt ** 2;
  return {
    position: p0 + direction * travel,
    velocity: direction * (peakVelocity - deceleration * dt),
  };
};

const positionAt = (
  profile: AxisProfile,
  time: number,
  acceleration: number,
  deceleration: number,
): number => positionVelocityAt(profile, time, acceleration, deceleration).position;

const scaleMotionParameter = (
  axis: AxisVad,
  oldTime: number,
  targetTime: number,
): AxisVad => {
  if (oldTime === 0) return cloneVad(axis);
  if (targetTime < oldTime) {
    throw new Error("target time cannot be less than original motion time");
  }
  if (targetTime === oldTime) return cloneVad(axis);
  const k = targetTime / oldTime;
  return {
    velocity: axis.velocity / k,
    acceleration: axis.acceleration / (k * k),
    deceleration: axis.deceleration / (k * k),
  };
};

const twoPointFrame = (
  height: number,
  argX: number,
  heightVel: number,
  argXVel: number,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  maxHeight: number,
): TwoPointFrame | null => {
  const hang = hangKind(baseHeight1, baseHeight2);
  if (!hang) return null;
  const half = lengthInside / 2;
  const angle = hang === "upper" ? argX : -argX;
  const angleVel = hang === "upper" ? argXVel : -argXVel;
  const xOffset = (angle / 90) ** 3 * half;
  const xOffsetVel = 3 * (angle / 90) ** 2 * (half / 90) * angleVel;
  const angleRad = angle * DEG_TO_RAD;
  const x0 = -half;
  const x1 = half;
  const y0 = hang === "upper" ? 0 : baseHeight2 + maxHeight;
  const y1 = y0;
  const xA = -Math.cos(angleRad) * half - xOffset;
  const xB = Math.cos(angleRad) * half - xOffset;
  const yA =
    hang === "upper"
      ? height - Math.sin(angleRad) * half + baseHeight1
      : height - Math.sin(angleRad) * half;
  const yB =
    hang === "upper"
      ? height + Math.sin(angleRad) * half + baseHeight1
      : height + Math.sin(angleRad) * half;
  return {
    x0,
    y0,
    x1,
    y1,
    xA,
    yA,
    xB,
    yB,
    xAVel: Math.sin(angleRad) * half * DEG_TO_RAD * angleVel - xOffsetVel,
    xBVel: -Math.sin(angleRad) * half * DEG_TO_RAD * angleVel - xOffsetVel,
    yAVel: heightVel - Math.cos(angleRad) * half * DEG_TO_RAD * angleVel,
    yBVel: heightVel + Math.cos(angleRad) * half * DEG_TO_RAD * angleVel,
  };
};

const twoPointLengthsFromFrame = (
  frame: TwoPointFrame,
  baseHeight1: number,
  baseHeight2: number,
  maxHeight: number,
): [number, number] => {
  const distanceA = Math.hypot(frame.xA - frame.x0, frame.yA - frame.y0);
  const distanceB = Math.hypot(frame.xB - frame.x1, frame.yB - frame.y1);
  if (hangKind(baseHeight1, baseHeight2) === "upper") {
    return [distanceA - baseHeight1, distanceB - baseHeight1];
  }
  const origin = baseHeight2 + maxHeight;
  return [origin - distanceA, origin - distanceB];
};

const twoPointMotorSpeed = (frame: TwoPointFrame): number => {
  const distanceA = Math.hypot(frame.xA - frame.x0, frame.yA - frame.y0);
  const distanceB = Math.hypot(frame.xB - frame.x1, frame.yB - frame.y1);
  const speedA = Math.abs(
    ((frame.xA - frame.x0) * frame.xAVel + (frame.yA - frame.y0) * frame.yAVel) / distanceA,
  );
  const speedB = Math.abs(
    ((frame.xB - frame.x1) * frame.xBVel + (frame.yB - frame.y1) * frame.yBVel) / distanceB,
  );
  return Math.max(speedA, speedB);
};

export const solveTwoPointForward = (input: TwoPointForwardInput): [number, number] => {
  const frame = twoPointFrame(
    input.height,
    input.pitch,
    0,
    0,
    input.baseHeight1,
    input.baseHeight2,
    input.lengthInside,
    input.maxHeight,
  );
  if (!frame) {
    throw new Error("two-point origin requires exactly one of baseHeight1 or baseHeight2");
  }
  return twoPointLengthsFromFrame(frame, input.baseHeight1, input.baseHeight2, input.maxHeight);
};

export const solveFourPointForward = (
  input: FourPointForwardInput,
): [number, number, number, number] => {
  if (input.moveWhat !== 1 && input.moveWhat !== 2) {
    return [input.height, input.height, input.height, input.height];
  }
  const span = input.moveWhat === 1 ? input.lengthInside : input.widthInside;
  const angle = input.moveWhat === 1 ? input.pitch : input.yaw;
  const frame = twoPointFrame(
    input.height,
    angle,
    0,
    0,
    input.baseHeight1,
    input.baseHeight2,
    span,
    input.maxHeight,
  );
  if (!frame) {
    throw new Error("four-point origin requires exactly one of baseHeight1 or baseHeight2");
  }
  const [left, right] = twoPointLengthsFromFrame(
    frame,
    input.baseHeight1,
    input.baseHeight2,
    input.maxHeight,
  );
  if (input.moveWhat === 1) return [left, right, right, left];
  return [right, right, left, left];
};

const singlePointPeakVelocity = (current: number, target: number, axis: AxisVad): number => {
  const distance = Math.abs(target - current);
  if (distance === 0) return 0;
  const accelDistance = axis.velocity ** 2 / (2 * axis.acceleration);
  const decelDistance = axis.velocity ** 2 / (2 * axis.deceleration);
  if (distance >= accelDistance + decelDistance) return axis.velocity;
  return Math.sqrt(
    (2 * distance * axis.acceleration * axis.deceleration) /
      (axis.acceleration + axis.deceleration),
  );
};

const profileKeyTimes = (profile: AxisProfile): number[] => [
  profile.accelTime,
  profile.accelTime + profile.cruiseTime,
  profile.totalTime,
];

const sampleTimes = (totalTime: number, extra: readonly number[]): number[] => {
  const times: number[] = [];
  for (let time = 0; time <= totalTime; time += INITIAL_TRANSITION_SAMPLE_DT) times.push(time);
  for (const time of extra) {
    if (time >= 0 && time <= totalTime) times.push(time);
  }
  return times;
};

const twoPointMaxMotorVelocity = (
  heightStart: number,
  heightTarget: number,
  pitchStart: number,
  pitchTarget: number,
  heightVad: AxisVad,
  pitchVad: AxisVad,
  baseHeight1: number,
  baseHeight2: number,
  lengthInside: number,
  maxHeight: number,
): number => {
  const heightProfile = buildProfile(
    heightStart,
    heightTarget,
    heightVad.velocity,
    heightVad.acceleration,
    heightVad.deceleration,
  );
  const pitchProfile = buildProfile(
    pitchStart,
    pitchTarget,
    pitchVad.velocity,
    pitchVad.acceleration,
    pitchVad.deceleration,
  );
  const totalTime = Math.max(heightProfile.totalTime, pitchProfile.totalTime);
  if (totalTime === 0) return 0;
  let maxVelocity = 0;
  const times = sampleTimes(totalTime, [...profileKeyTimes(heightProfile), ...profileKeyTimes(pitchProfile), totalTime]);
  for (const time of times) {
    const height = positionVelocityAt(
      heightProfile,
      time,
      heightVad.acceleration,
      heightVad.deceleration,
    );
    const pitch = positionVelocityAt(
      pitchProfile,
      time,
      pitchVad.acceleration,
      pitchVad.deceleration,
    );
    const frame = twoPointFrame(
      height.position,
      pitch.position,
      height.velocity,
      pitch.velocity,
      baseHeight1,
      baseHeight2,
      lengthInside,
      maxHeight,
    );
    if (!frame) continue;
    maxVelocity = Math.max(maxVelocity, twoPointMotorSpeed(frame));
  }
  return maxVelocity;
};

const fourPointMaxMotorVelocity = (model: FourPointTransitionInput, vad: [AxisVad, AxisVad, AxisVad]): number => {
  const heightProfile = buildProfile(
    model.current.h,
    model.target.h,
    vad[AXIS_H].velocity,
    vad[AXIS_H].acceleration,
    vad[AXIS_H].deceleration,
  );
  const moveWhat = model.moveWhat;
  const angleStart = moveWhat === 1 ? model.current.p : moveWhat === 2 ? model.current.y : 0;
  const angleTarget = moveWhat === 1 ? model.target.p : moveWhat === 2 ? model.target.y : 0;
  const angleVad = moveWhat === 1 ? vad[AXIS_P] : moveWhat === 2 ? vad[AXIS_Y] : vad[AXIS_H];
  const angleProfile =
    moveWhat === 1 || moveWhat === 2
      ? buildProfile(
          angleStart,
          angleTarget,
          angleVad.velocity,
          angleVad.acceleration,
          angleVad.deceleration,
        )
      : idleProfile(0, 0);
  const totalTime = Math.max(heightProfile.totalTime, angleProfile.totalTime);
  if (totalTime === 0) return 0;
  let maxVelocity = 0;
  const times = sampleTimes(totalTime, [...profileKeyTimes(heightProfile), ...profileKeyTimes(angleProfile), totalTime]);
  for (const time of times) {
    const height = positionVelocityAt(
      heightProfile,
      time,
      vad[AXIS_H].acceleration,
      vad[AXIS_H].deceleration,
    );
    if (moveWhat !== 1 && moveWhat !== 2) {
      maxVelocity = Math.max(maxVelocity, Math.abs(height.velocity));
      continue;
    }
    const angle = positionVelocityAt(
      angleProfile,
      time,
      angleVad.acceleration,
      angleVad.deceleration,
    );
    const span = moveWhat === 1 ? model.lengthInside : model.widthInside;
    const frame = twoPointFrame(
      height.position,
      angle.position,
      height.velocity,
      angle.velocity,
      model.baseHeight1,
      model.baseHeight2,
      span,
      model.maxHeight,
    );
    if (!frame) {
      throw new Error("four-point origin requires exactly one of baseHeight1 or baseHeight2");
    }
    maxVelocity = Math.max(maxVelocity, twoPointMotorSpeed(frame));
  }
  return maxVelocity;
};

const multiPointLengths = (
  model: MultiPointTransitionInput,
  height: number,
  pitch: number,
  yaw: number,
): number[] =>
  solveMultiPointForward({
    height,
    roll: yaw,
    pitch,
    pointInitPos: model.pointInitPos,
    baseHeight1: model.baseHeight1,
    baseHeight2: model.baseHeight2,
    maxHeight: model.maxHeight,
    betaInit: model.betaInit,
  });

const multiPointMaxMotorVelocity = (
  model: MultiPointTransitionInput,
  vad: [AxisVad, AxisVad, AxisVad],
): number => {
  const heightProfile = buildProfile(
    model.current.h,
    model.target.h,
    vad[AXIS_H].velocity,
    vad[AXIS_H].acceleration,
    vad[AXIS_H].deceleration,
  );
  const pitchProfile = buildProfile(
    model.current.p,
    model.target.p,
    vad[AXIS_P].velocity,
    vad[AXIS_P].acceleration,
    vad[AXIS_P].deceleration,
  );
  const yawProfile = buildProfile(
    model.current.y,
    model.target.y,
    vad[AXIS_Y].velocity,
    vad[AXIS_Y].acceleration,
    vad[AXIS_Y].deceleration,
  );
  const totalTime = Math.max(heightProfile.totalTime, pitchProfile.totalTime, yawProfile.totalTime);
  if (totalTime === 0) return 0;

  let lastLength = multiPointLengths(model, model.current.h, model.current.p, model.current.y);
  let maxVelocity = 0;
  let lastTime = 0;
  let time = INITIAL_TRANSITION_SAMPLE_DT;
  while (lastTime < totalTime) {
    if (time > totalTime) time = totalTime;
    const height = positionAt(heightProfile, time, vad[AXIS_H].acceleration, vad[AXIS_H].deceleration);
    const pitch = positionAt(pitchProfile, time, vad[AXIS_P].acceleration, vad[AXIS_P].deceleration);
    const yaw = positionAt(yawProfile, time, vad[AXIS_Y].acceleration, vad[AXIS_Y].deceleration);
    const currentLength = multiPointLengths(model, height, pitch, yaw);
    const dt = time - lastTime;
    for (let index = 0; index < currentLength.length; index += 1) {
      const previous = lastLength[index];
      const next = currentLength[index];
      if (previous === undefined || next === undefined || dt === 0) continue;
      maxVelocity = Math.max(maxVelocity, Math.abs(next - previous) / dt);
    }
    lastLength = currentLength;
    lastTime = time;
    time += INITIAL_TRANSITION_SAMPLE_DT;
  }
  return maxVelocity;
};

const activeAxesOf = (model: InitialTransitionModelInput): number[] => {
  if (model.type === 1) return [AXIS_H];
  if (model.type === 2) return [AXIS_H, AXIS_P];
  if (model.type === 4) {
    if (model.moveWhat === 1) return [AXIS_H, AXIS_P];
    if (model.moveWhat === 2) return [AXIS_H, AXIS_Y];
    return [AXIS_H];
  }
  return [AXIS_H, AXIS_P, AXIS_Y];
};

const calcModelMaxVelocity = (
  input: InitialTransitionModelInput,
  vad: [AxisVad, AxisVad, AxisVad],
): number => {
  if (input.type === 1) {
    return singlePointPeakVelocity(input.current.h, input.target.h, vad[AXIS_H]);
  }
  if (input.type === 2) {
    return twoPointMaxMotorVelocity(
      input.current.h,
      input.target.h,
      input.current.p,
      input.target.p,
      vad[AXIS_H],
      vad[AXIS_P],
      input.baseHeight1,
      input.baseHeight2,
      input.lengthInside,
      input.maxHeight,
    );
  }
  if (input.type === 4) return fourPointMaxMotorVelocity(input, vad);
  return multiPointMaxMotorVelocity(input, vad);
};

const toWorking = (input: InitialTransitionModelInput): WorkingModel => ({
  input,
  vad: [cloneVad(input.h), cloneVad(input.p), cloneVad(input.y)],
  axisTime: [0, 0, 0],
  modelTime: 0,
  safeTime: 0,
});

const scaleMovingAxes = (
  work: WorkingModel,
  axes: readonly number[],
  oldTime: number,
  targetTime: number,
) => {
  for (const axis of axes) {
    if (work.axisTime[axis]! <= 0) continue;
    work.vad[axis] = scaleMotionParameter(work.vad[axis]!, oldTime, targetTime);
  }
};

const modelLabel = (input: InitialTransitionModelInput, index: number): string =>
  input.id !== undefined ? String(input.id) : String(index);

const validateFinalVelocity = (works: WorkingModel[]): void => {
  for (const [index, work] of works.entries()) {
    const finalMaxVelocity = calcModelMaxVelocity(work.input, work.vad);
    if (finalMaxVelocity > work.input.maxMotorVelocity + 1e-6) {
      throw new Error(
        `model ${modelLabel(work.input, index)} final velocity check failed: ` +
          `max motor speed=${finalMaxVelocity}, limit=${work.input.maxMotorVelocity}`,
      );
    }
  }
};

const toResult = (
  work: WorkingModel,
  totalTime: number,
  finalMaxVelocity: number,
): InitialTransitionModelResult => {
  const result: InitialTransitionModelResult = {
    type: work.input.type,
    time: totalTime,
    H: cloneVad(work.vad[AXIS_H]),
    P: cloneVad(work.vad[AXIS_P]),
    Y: cloneVad(work.vad[AXIS_Y]),
    finalMaxVelocity,
    maxMotorVelocity: work.input.maxMotorVelocity,
    velocityCheck: true,
  };
  if (work.input.id !== undefined) result.id = work.input.id;
  return result;
};

export const planInitialTransition = (
  models: readonly InitialTransitionModelInput[],
): InitialTransitionPlan => {
  if (models.length === 0) return { totalTime: 0, models: [] };

  const works = models.map(toWorking);

  for (const [index, work] of works.entries()) {
    if (!(work.input.maxMotorVelocity > 0)) {
      throw new Error(`model ${modelLabel(work.input, index)} max motor velocity must be greater than 0`);
    }
    const axes = activeAxesOf(work.input);
    const axisTime: [number, number, number] = [0, 0, 0];
    for (const axis of axes) {
      const vad = work.vad[axis]!;
      axisTime[axis] = calcMotionTime(
        poseComponent(work.input.current, axis),
        poseComponent(work.input.target, axis),
        vad.velocity,
        vad.acceleration,
        vad.deceleration,
      );
    }
    work.axisTime = axisTime;
    const modelTime = Math.max(...axisTime);
    work.modelTime = modelTime;
    if (modelTime > 0) {
      for (const axis of axes) {
        const original = axisTime[axis]!;
        if (original > 0 && original < modelTime) {
          work.vad[axis] = scaleMotionParameter(work.vad[axis]!, original, modelTime);
        }
      }
    }
    const maxVelocity = calcModelMaxVelocity(work.input, work.vad);
    if (maxVelocity > work.input.maxMotorVelocity && modelTime > 0) {
      const safeTime = (modelTime * maxVelocity * OVERSPEED_SAFETY_FACTOR) / work.input.maxMotorVelocity;
      scaleMovingAxes(work, axes, modelTime, safeTime);
      work.safeTime = safeTime;
    } else {
      work.safeTime = modelTime;
    }
  }

  const totalTime = Math.max(...works.map((work) => work.safeTime));
  for (const work of works) {
    if (work.safeTime > 0 && work.safeTime < totalTime) {
      scaleMovingAxes(work, activeAxesOf(work.input), work.safeTime, totalTime);
    }
  }

  validateFinalVelocity(works);

  return {
    totalTime,
    models: works.map((work) =>
      toResult(work, totalTime, calcModelMaxVelocity(work.input, work.vad)),
    ),
  };
};
