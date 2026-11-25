import type { MotionBoundary } from "@/app/project/action-sequence/motion-profile";
import { minimumMotionProfile } from "@/app/project/action-sequence/nearest-start-motion";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { TIME_STEP_MS } from "../timeline/timeline-data";
import { profileFromRates, trapezoidRatesOf } from "./phase-rates";

/** 起步（段首变速）或收尾（段尾变速） */
export type RampPhase = "accel" | "decel";

/** 起步、收尾的急缓档位 */
export type RampPreset = "soft" | "standard" | "quick";

export const RAMP_PRESETS: ReadonlyArray<{ id: RampPreset; label: string }> = [
  { id: "soft", label: "缓" },
  { id: "standard", label: "标准" },
  { id: "quick", label: "快" },
];

/** 「快」档和「最快」参考时长不超过上限的这个比例 */
export const LIMIT_MARGIN = 0.95;

/** 一个轴在搭建里设的默认速度、加速度和上限（单位/秒、单位/秒²）；没配的为 undefined */
export type AxisRateLimits = {
  defaultSpeed?: number;
  defaultAccel?: number;
  maxSpeed?: number;
  maxAccel?: number;
};

/** 一个轴在这段里的曲线：行程（绝对值）、时长和进出速度 */
export type AxisRampInput = {
  profile: MotionProfile;
  distance: number;
  durationMs: number;
  boundary?: MotionBoundary;
};

export type SegmentRampAxis = AxisRampInput & { limits: AxisRateLimits };

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * 档位的加减速度：标准 = 搭建里设的加速度（不超过上限），缓 = 标准的一半，
 * 快 = 标准的两倍、不超过上限的 95%（上限比标准还低时就是标准）。搭建没设加速度时为 null。
 */
export const presetRate = (limits: AxisRateLimits, preset: RampPreset): number | null => {
  const base = positive(limits.defaultAccel);
  if (base === undefined) return null;
  const max = positive(limits.maxAccel);
  const standard = max === undefined ? base : Math.min(base, max);
  if (preset === "standard") return standard;
  if (preset === "soft") return standard / 2;
  const quick = standard * 2;
  return max === undefined ? quick : Math.max(standard, Math.min(quick, max * LIMIT_MARGIN));
};

/** 两段变速都在、而且中间还有匀速 */
const fits = (profile: MotionProfile | null, durationMs: number): profile is MotionProfile =>
  profile?.kind === "trapezoid" && profile.params.accelMs + profile.params.decelMs < durationMs;

/**
 * 起步和收尾都换成这一档：时长、行程、进出速度不变，匀速跟着变。
 * 搭建没设加速度、这段时间里变不过来，或取整到 0.1 s 后没有匀速段时为 null。
 */
export const withRampPreset = (input: SegmentRampAxis, preset: RampPreset): MotionProfile | null => {
  const rate = presetRate(input.limits, preset);
  if (rate === null || !(input.distance > 0)) return null;
  const next = profileFromRates({
    distance: input.distance,
    durationMs: input.durationMs,
    boundary: input.boundary,
    acceleration: rate,
    deceleration: rate,
  });
  return fits(next, input.durationMs) ? next : null;
};

const rampMsOf = (profile: MotionProfile, phase: RampPhase): number | undefined => {
  if (profile.kind !== "trapezoid") return undefined;
  return phase === "accel" ? profile.params.accelMs : profile.params.decelMs;
};

/** 起步或收尾要变的速度：匀速和这一头进出速度之差；算不出曲线时为 null */
const speedChangeOf = (input: AxisRampInput, phase: RampPhase): number | null => {
  const rates = trapezoidRatesOf(input.profile, input.distance, input.durationMs, input.boundary);
  if (!rates) return null;
  const edgeSpeed = phase === "accel" ? (input.boundary?.startSpeed ?? 0) : (input.boundary?.endSpeed ?? 0);
  return Math.abs(rates.cruiseSpeed - edgeSpeed);
};

/**
 * 现在的起步或收尾是哪一档：按现在的匀速，这一档该用的变速时间和现在的差不到一档（0.1 s，
 * 变速时间取整到 0.1 s 带来的差）；几档都够近时取最近的，都不够近时为 null（自定义）。
 */
export const matchingRampPreset = (
  input: AxisRampInput,
  phase: RampPhase,
  limits: AxisRateLimits,
): RampPreset | null => {
  const currentMs = rampMsOf(input.profile, phase);
  if (currentMs === undefined || !(input.distance > 0)) return null;
  const change = speedChangeOf(input, phase);
  if (change === null) return null;
  let best: { preset: RampPreset; diffMs: number } | null = null;
  for (const { id } of RAMP_PRESETS) {
    const rate = presetRate(limits, id);
    if (rate === null) continue;
    const diffMs = Math.abs((change / rate) * 1000 - currentMs);
    if (diffMs <= TIME_STEP_MS + 1e-6 && (best === null || diffMs < best.diffMs)) {
      best = { preset: id, diffMs };
    }
  }
  return best?.preset ?? null;
};

/**
 * 起步收尾是哪一档：两头在同一档才算。一头几乎不用变速（接着上一段 / 下一段差不多的速度走，
 * 按「缓」也用不到 0.1 s）时分不出档，只看另一头；两头不在同一档、或都不在档上时为 null。
 */
export const rampPresetOf = (input: SegmentRampAxis): RampPreset | null => {
  const softest = presetRate(input.limits, "soft");
  if (softest === null) return null;
  const phases = (["accel", "decel"] as const).filter(
    (phase) => ((speedChangeOf(input, phase) ?? 0) / softest) * 1000 >= TIME_STEP_MS,
  );
  if (phases.length === 0) return null;
  const found = phases.map((phase) => matchingRampPreset(input, phase, input.limits));
  const first = found[0] ?? null;
  return first !== null && found.every((preset) => preset === first) ? first : null;
};

/** 参考时长：默认速度 = 搭建里的速度配「标准」档；最快 = 上限 95% 的速度配「快」档 */
export type ReferenceKind = "default" | "fastest";

export const referenceRates = (
  limits: AxisRateLimits,
  kind: ReferenceKind,
): { speed: number; acceleration: number } | null => {
  const acceleration = presetRate(limits, kind === "default" ? "standard" : "quick");
  const maxSpeed = positive(limits.maxSpeed);
  if (acceleration === null) return null;
  if (kind === "fastest") {
    return maxSpeed === undefined ? null : { speed: maxSpeed * LIMIT_MARGIN, acceleration };
  }
  const speed = positive(limits.defaultSpeed);
  if (speed === undefined) return null;
  return { speed: maxSpeed === undefined ? speed : Math.min(speed, maxSpeed), acceleration };
};

/** 一个轴按参考档从静止走到静止要多久，向上取到 0.1 s（不考虑前后的经过速度） */
const axisReferenceMs = (axis: SegmentRampAxis, kind: ReferenceKind): number | null => {
  const rates = referenceRates(axis.limits, kind);
  if (!rates || !(axis.distance > 0)) return null;
  try {
    const { time } = minimumMotionProfile(axis.distance, rates.speed, rates.acceleration, rates.acceleration);
    return Math.max(1, Math.ceil((time * 1000) / TIME_STEP_MS - 1e-9)) * TIME_STEP_MS;
  } catch {
    return null;
  }
};

/** 按参考档把这一轴改成 durationMs：起步、收尾都换成这一档的加减速度；放不下时为 null */
const referenceProfile = (
  axis: SegmentRampAxis,
  kind: ReferenceKind,
  durationMs: number,
): MotionProfile | null => {
  const rates = referenceRates(axis.limits, kind);
  if (!rates) return null;
  const profile = profileFromRates({
    distance: axis.distance,
    durationMs,
    boundary: axis.boundary,
    acceleration: rates.acceleration,
    deceleration: rates.acceleration,
  });
  return fits(profile, durationMs) ? profile : null;
};

/** 按参考档改整段：新时长和各个要动的轴的曲线 */
export type ReferencePlan = { durationMs: number; profiles: Map<VirtualAxisId, MotionProfile> };

/** 取整到 0.1 s 后两段变速可能占满整段：最多再往后加这么多档找放得下的时长 */
const REFERENCE_EXTRA_STEPS = 5;

/**
 * 整段按参考档：时长取要动的轴里最长的那个，各轴的起步、收尾换成这一档的加减速度。
 * 没有要动的轴、有轴没配速度或加速度、或加几档仍放不下时为 null。
 */
export const referencePlan = (
  axes: ReadonlyArray<SegmentRampAxis & { axis: VirtualAxisId }>,
  kind: ReferenceKind,
): ReferencePlan | null => {
  const moving = axes.filter((axis) => axis.distance > 0);
  if (moving.length === 0) return null;
  let base = 0;
  for (const axis of moving) {
    const ms = axisReferenceMs(axis, kind);
    if (ms === null) return null;
    base = Math.max(base, ms);
  }
  for (let extra = 0; extra <= REFERENCE_EXTRA_STEPS; extra += 1) {
    const durationMs = base + extra * TIME_STEP_MS;
    const profiles = new Map<VirtualAxisId, MotionProfile>();
    for (const axis of moving) {
      const profile = referenceProfile(axis, kind, durationMs);
      if (!profile) break;
      profiles.set(axis.axis, profile);
    }
    if (profiles.size === moving.length) return { durationMs, profiles };
  }
  return null;
};

/**
 * 改时长后这一轴的曲线：起步、收尾有一头在档上，就按档位（另一头按现在的变化率）重算；
 * 都不在档上的保留变速时间，放不下时按比例缩短，各至少 0.1 s。
 */
export const profileForDuration = (axis: SegmentRampAxis, nextDurationMs: number): MotionProfile => {
  const { profile } = axis;
  if (profile.kind !== "trapezoid" || !(axis.distance > 0)) return profile;
  const accelPreset = matchingRampPreset(axis, "accel", axis.limits);
  const decelPreset = matchingRampPreset(axis, "decel", axis.limits);
  if (accelPreset || decelPreset) {
    const current = trapezoidRatesOf(profile, axis.distance, axis.durationMs, axis.boundary);
    const acceleration = accelPreset ? presetRate(axis.limits, accelPreset) : current?.acceleration;
    const deceleration = decelPreset ? presetRate(axis.limits, decelPreset) : current?.deceleration;
    if (acceleration && deceleration) {
      const next = profileFromRates({
        distance: axis.distance,
        durationMs: nextDurationMs,
        boundary: axis.boundary,
        acceleration,
        deceleration,
      });
      if (fits(next, nextDurationMs)) return next;
    }
  }
  const { accelMs, decelMs } = profile.params;
  if (accelMs + decelMs < nextDurationMs) return profile;
  const room = Math.max(nextDurationMs - TIME_STEP_MS, 2 * TIME_STEP_MS);
  const scale = room / (accelMs + decelMs);
  const shrink = (ms: number) =>
    Math.max(TIME_STEP_MS, Math.floor((ms * scale) / TIME_STEP_MS) * TIME_STEP_MS);
  return { kind: "trapezoid", params: { accelMs: shrink(accelMs), decelMs: shrink(decelMs) } };
};
