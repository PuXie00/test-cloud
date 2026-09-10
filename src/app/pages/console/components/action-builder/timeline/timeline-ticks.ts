/** 主刻度候选间隔（秒）— Blender 式 nice numbers */
export const NICE_STEP_SECONDS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
] as const;

/** 主刻度目标像素间距 */
export const TARGET_MAJOR_TICK_PX = 80;

export type TimelineTickKind = "major" | "minor" | "sub";

export type TimelineTick = {
  /** 时刻（毫秒） */
  ms: number;
  kind: TimelineTickKind;
  /** 主刻度标签（秒数或 mm:ss） */
  label?: string;
};

export type NiceTimeTicks = {
  majorStepSec: number;
  minorStepSec: number;
  subStepSec: number | null;
  ticks: TimelineTick[];
};

const formatTickLabel = (seconds: number): string => {
  if (seconds < 60 && seconds === Math.floor(seconds)) return String(seconds);
  if (seconds < 60) return seconds.toFixed(1).replace(/\.0$/, "");
  const total = Math.round(seconds * 10) / 10;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (s === 0) return `${m}:00`;
  if (Number.isInteger(s)) return `${m}:${String(s).padStart(2, "0")}`;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

/** 按像素密度选出最接近目标间距的主刻度秒数 */
export const pickNiceMajorStepSec = (pxPerSecond: number): number => {
  const pps = Math.max(pxPerSecond, 0.001);
  let best: (typeof NICE_STEP_SECONDS)[number] = NICE_STEP_SECONDS[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const step of NICE_STEP_SECONDS) {
    const dist = Math.abs(step * pps - TARGET_MAJOR_TICK_PX);
    if (dist < bestDist) {
      bestDist = dist;
      best = step;
    }
  }
  return best;
};

/**
 * Blender 风格自适应刻度（单位：秒）。
 * 主 / 次 / 细分；主刻度带标签。
 */
export const computeNiceTimeTicks = (
  pxPerSecond: number,
  endMs: number,
  startMs = 0,
): NiceTimeTicks => {
  const majorStepSec = pickNiceMajorStepSec(pxPerSecond);
  const minorStepSec = majorStepSec / 5;
  const majorPx = majorStepSec * pxPerSecond;
  const subStepSec = majorPx >= 100 ? minorStepSec / 2 : null;
  const stepSec = subStepSec ?? minorStepSec;
  const padMs = majorStepSec * 1000;
  const rangeStartSec = Math.max(0, startMs - padMs) / 1000;
  const rangeEndSec = Math.max(endMs + padMs, 0) / 1000;
  const ticks: TimelineTick[] = [];
  const eps = stepSec * 1e-6;
  const firstSec = Math.floor(rangeStartSec / stepSec) * stepSec;

  for (let t = firstSec; t <= rangeEndSec + eps; t += stepSec) {
    const sec = Math.round(t / stepSec) * stepSec;
    if (sec + eps < rangeStartSec) continue;
    if (sec > rangeEndSec + eps) break;
    const ms = Math.round(sec * 1000);
    const nearMajor = Math.abs(sec / majorStepSec - Math.round(sec / majorStepSec)) < 1e-6;
    const nearMinor = Math.abs(sec / minorStepSec - Math.round(sec / minorStepSec)) < 1e-6;
    if (nearMajor) {
      ticks.push({ ms, kind: "major", label: formatTickLabel(sec) });
    } else if (nearMinor) {
      ticks.push({ ms, kind: "minor" });
    } else if (subStepSec !== null) {
      ticks.push({ ms, kind: "sub" });
    }
  }

  return { majorStepSec, minorStepSec, subStepSec, ticks };
};