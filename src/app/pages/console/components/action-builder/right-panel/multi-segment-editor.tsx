import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/app/components/ui/utils";
import {
  hasMotionBoundary,
  withTrapezoidAccelMs,
  withTrapezoidDecelMs,
} from "@/app/project/action-sequence/motion-profile";
import {
  segmentAxisMotion,
  type ResolvedAxisMotion,
  type ResolvedMotionSegment,
} from "@/app/project/action-sequence/resolve-sequence";
import type { MotionProfile } from "@/app/project/action-sequence/types";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { PhaseInputModeTabs } from "../motion-profile/motion-profile-editor";
import { axisHasWarning, resolveEnabledAxes } from "../motion-profile/motion-profile-status";
import {
  SPEED_UNREACHABLE_MESSAGE,
  retimeFromRates,
  stepPhaseTime,
  stepRetimedRate,
  stepRetimedSpeed,
  type RatePhase,
  type RetimedProfile,
  trapezoidRatesOf,
} from "../motion-profile/phase-rates";
import {
  phaseFieldLabels,
  RateRow,
  TimeRow,
} from "../motion-profile/trapezoid-profile-editor";
import type { SegmentProfileWrite, SegmentRetimeWrite } from "../sequence-ops";
import { VIRTUAL_AXIS_IDS } from "../timeline/timeline-data";
import { useActionBuilder } from "../use-action-builder";
import { getVirtualAxisCanonicalUnit } from "../virtual-axis-display";
import { segmentEditContext } from "./segment-editor";

/** 某个轴在选中区间里要改的一段曲线；轴在端点经过时几个区间共用一段 */
type AxisCurve = {
  objectId: number;
  motion: ResolvedAxisMotion;
  distance: number;
  unit: string;
};

const axisName = (axis: VirtualAxisId): string => axis.toUpperCase();

/** 都一样时返回这个值，否则（或没有值）返回 undefined，显示 -- */
const sharedValue = (values: readonly (number | undefined)[]): number | undefined => {
  const first = values[0];
  if (first === undefined) return undefined;
  const rounded = roundProjectCoordinate(first);
  return values.every((value) => value !== undefined && roundProjectCoordinate(value) === rounded)
    ? first
    : undefined;
};

/**
 * 多选运动区间的阶段批量修改：选一个轴，按时间或按速度填，写给选中区间里这个轴在动的每段曲线
 * （跨过端点的整段曲线只写一次）。
 */
export const MultiSegmentEditor = ({ segments }: { segments: ResolvedMotionSegment[] }) => {
  const {
    getTimelineObject,
    phaseInputMode,
    handlePhaseInputModeChange,
    handleWriteSegmentProfiles,
    handleRetimeSegmentCurves,
  } = useActionBuilder();

  const enabledAxesOf = (segment: ResolvedMotionSegment) =>
    resolveEnabledAxes(getTimelineObject(segment.objectId)?.enabledAxes ?? []);
  const axes = VIRTUAL_AXIS_IDS.filter((axis) =>
    segments.some((segment) => enabledAxesOf(segment).includes(axis)),
  );
  const curvesOf = (axis: VirtualAxisId): AxisCurve[] => {
    const seen = new Set<string>();
    const curves: AxisCurve[] = [];
    for (const segment of segments) {
      if (!enabledAxesOf(segment).includes(axis)) continue;
      const motion = segmentAxisMotion(segment, axis);
      const key = `${segment.objectId}:${motion.fromRef}->${motion.toRef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const distance = Math.abs(motion.to - motion.from);
      if (!motion.configurable || distance === 0 || motion.profile.kind !== "trapezoid") continue;
      const object = getTimelineObject(segment.objectId);
      curves.push({
        objectId: segment.objectId,
        motion,
        distance,
        unit: getVirtualAxisCanonicalUnit(axis, object?.controlType),
      });
    }
    return curves;
  };
  const axisWarned = (axis: VirtualAxisId) =>
    segments.some((segment) => {
      const { profiles, axisContext } = segmentEditContext(segment, getTimelineObject(segment.objectId));
      return axisHasWarning(axis, profiles, axisContext);
    });

  const [pickedAxis, setPickedAxis] = useState<VirtualAxisId | null>(null);
  const currentAxis =
    pickedAxis !== null && axes.includes(pickedAxis)
      ? pickedAxis
      : (axes.find((axis) => curvesOf(axis).length > 0) ?? axes[0] ?? "v1");
  const curves = curvesOf(currentAxis);
  const labels = phaseFieldLabels(
    phaseInputMode,
    curves.some((curve) => hasMotionBoundary(curve.motion)),
  );
  const units = [...new Set(curves.map((curve) => curve.unit))];
  const unit = units.length === 1 ? units[0] : undefined;
  const ratesOf = (curve: AxisCurve) =>
    trapezoidRatesOf(curve.motion.profile, curve.distance, curve.motion.durationMs, curve.motion);
  const paramsOf = (curve: AxisCurve) =>
    curve.motion.profile.kind === "trapezoid" ? curve.motion.profile.params : null;

  /** 按时间：时长不变，只换曲线 */
  const write = (makeProfile: (curve: AxisCurve) => MotionProfile | null) => {
    const writes: SegmentProfileWrite[] = [];
    for (const curve of curves) {
      const profile = makeProfile(curve);
      if (!profile) continue;
      writes.push({
        fromRef: curve.motion.fromRef,
        toRef: curve.motion.toRef,
        axis: currentAxis,
        profile,
        durationMs: curve.motion.durationMs,
      });
    }
    if (writes.length > 0) handleWriteSegmentProfiles(writes);
  };

  /** 按速度：每段按自己的结果换时长，终点和这个物体后面的块一起挪 */
  const retime = (makeRetimed: (curve: AxisCurve) => RetimedProfile | null, reportMisfit: boolean) => {
    const writes: SegmentRetimeWrite[] = [];
    let misfits = 0;
    for (const curve of curves) {
      const next = makeRetimed(curve);
      if (!next) {
        misfits += 1;
        continue;
      }
      writes.push({
        objectId: curve.objectId,
        fromRef: curve.motion.fromRef,
        toRef: curve.motion.toRef,
        axis: currentAxis,
        profile: next.profile,
        durationMs: next.durationMs,
      });
    }
    if (writes.length > 0) handleRetimeSegmentCurves(writes);
    if (reportMisfit && misfits > 0) {
      toast.warning(`有 ${misfits} 段没有修改：${SPEED_UNREACHABLE_MESSAGE}`);
    }
  };

  const writeRates = (patch: Partial<{ acceleration: number; cruiseSpeed: number; deceleration: number }>) =>
    retime((curve) => {
      const rates = ratesOf(curve);
      if (!rates) return null;
      return retimeFromRates({ distance: curve.distance, boundary: curve.motion, ...rates, ...patch });
    }, true);

  // 点 − + 时每段各自走一档；还没重新渲染就来了下一下时从刚写的接着走
  const curveKey = (curve: AxisCurve) => `${curve.motion.fromRef}->${curve.motion.toRef}`;
  const latestRef = useRef(new Map<string, RetimedProfile>());
  latestRef.current = new Map(
    curves.map((curve) => [
      curveKey(curve),
      { profile: curve.motion.profile, durationMs: curve.motion.durationMs },
    ]),
  );
  const latestOf = (curve: AxisCurve): RetimedProfile =>
    latestRef.current.get(curveKey(curve)) ?? {
      profile: curve.motion.profile,
      durationMs: curve.motion.durationMs,
    };
  const remember = (curve: AxisCurve, next: RetimedProfile | null) => {
    if (next) latestRef.current.set(curveKey(curve), next);
    return next;
  };
  const stepRates = (phase: RatePhase) => (delta: number) =>
    retime(
      (curve) =>
        remember(
          curve,
          stepRetimedRate({
            ...latestOf(curve),
            distance: curve.distance,
            boundary: curve.motion,
            phase,
            steps: delta,
          }),
        ),
      false,
    );
  const stepSpeeds = (delta: number) =>
    retime(
      (curve) =>
        remember(
          curve,
          stepRetimedSpeed({
            ...latestOf(curve),
            distance: curve.distance,
            boundary: curve.motion,
            steps: delta,
          }),
        ),
      false,
    );
  const stepTimes = (phase: RatePhase) => (delta: number) =>
    write((curve) => {
      const latest = latestOf(curve);
      const next = stepPhaseTime(latest.profile, latest.durationMs, phase, delta);
      remember(curve, next ? { profile: next, durationMs: latest.durationMs } : null);
      return next;
    });

  const editable = curves.length > 0;
  const allRates = curves.map(ratesOf);
  const allParams = curves.map(paramsOf);
  const shared = {
    accelMs: sharedValue(allParams.map((params) => params?.accelMs)),
    cruiseMs: sharedValue(
      allParams.map((params, index) =>
        params ? curves[index]!.motion.durationMs - params.accelMs - params.decelMs : undefined,
      ),
    ),
    decelMs: sharedValue(allParams.map((params) => params?.decelMs)),
    acceleration: sharedValue(allRates.map((rates) => rates?.acceleration)),
    cruiseSpeed: sharedValue(allRates.map((rates) => rates?.cruiseSpeed)),
    deceleration: sharedValue(allRates.map((rates) => rates?.deceleration)),
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1 rounded-md bg-input-background p-1" role="group" aria-label="虚拟轴">
        {axes.map((axis) => {
          const pressed = axis === currentAxis;
          const count = curvesOf(axis).length;
          return (
            <button
              key={axis}
              type="button"
              aria-label={`${axisName(axis)} ${count > 0 ? `${count} 段` : "无位移"}`}
              aria-pressed={pressed}
              onClick={() => setPickedAxis(axis)}
              className={cn(
                "min-w-0 flex-1 rounded-sm border-b-2 px-1 py-1.5 text-center",
                pressed
                  ? "border-primary bg-accent text-primary"
                  : "border-transparent text-muted-foreground hover:bg-accent",
              )}
            >
              <span className="block text-body-sm font-semibold">
                {axisName(axis)}
                {axisWarned(axis) ? <span className="ml-1 text-warning">●</span> : null}
              </span>
              <span className="block truncate text-[10px] leading-3">
                {count > 0 ? `${count} 段` : "无位移"}
              </span>
            </button>
          );
        })}
      </div>

      <section className="rounded-md bg-muted p-3" aria-label="阶段">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-label-caps text-muted-foreground">阶段</h3>
          <PhaseInputModeTabs mode={phaseInputMode} onChange={handlePhaseInputModeChange} />
        </div>
        {phaseInputMode === "speed" ? (
          <div className="flex flex-col gap-1.5">
            <RateRow
              label={labels.first}
              value={shared.acceleration}
              unit={unit === undefined ? undefined : `${unit}/s²`}
              readOnly={!editable}
              onValueCommit={editable ? (next) => writeRates({ acceleration: next }) : undefined}
              onStep={editable ? stepRates("accel") : undefined}
            />
            <RateRow
              label={labels.middle}
              value={shared.cruiseSpeed}
              unit={unit === undefined ? undefined : `${unit}/s`}
              readOnly={!editable}
              onValueCommit={editable ? (next) => writeRates({ cruiseSpeed: next }) : undefined}
              onStep={editable ? stepSpeeds : undefined}
            />
            <RateRow
              label={labels.last}
              value={shared.deceleration}
              unit={unit === undefined ? undefined : `${unit}/s²`}
              readOnly={!editable}
              onValueCommit={editable ? (next) => writeRates({ deceleration: next }) : undefined}
              onStep={editable ? stepRates("decel") : undefined}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <TimeRow
              label={labels.first}
              valueMs={shared.accelMs ?? 0}
              mixed={shared.accelMs === undefined}
              readOnly={!editable}
              onValueCommit={
                editable
                  ? (nextMs) => write((curve) => withTrapezoidAccelMs(curve.motion.profile, nextMs))
                  : undefined
              }
              onStep={editable ? stepTimes("accel") : undefined}
            />
            <TimeRow
              label={labels.middle}
              valueMs={shared.cruiseMs ?? 0}
              mixed={shared.cruiseMs === undefined}
              readOnly
            />
            <TimeRow
              label={labels.last}
              valueMs={shared.decelMs ?? 0}
              mixed={shared.decelMs === undefined}
              readOnly={!editable}
              onValueCommit={
                editable
                  ? (nextMs) => write((curve) => withTrapezoidDecelMs(curve.motion.profile, nextMs))
                  : undefined
              }
              onStep={editable ? stepTimes("decel") : undefined}
            />
          </div>
        )}
        <p className="mt-2 text-body-sm text-muted-foreground">
          {!editable
            ? `选中的区间里 ${axisName(currentAxis)} 没有位移`
            : phaseInputMode === "speed"
              ? `改动写给 ${axisName(currentAxis)} 在动的 ${curves.length} 段曲线，各段时长跟着变，后面的块一起挪`
              : `改动写给 ${axisName(currentAxis)} 在动的 ${curves.length} 段曲线，各段时长不变`}
        </p>
      </section>
    </div>
  );
};
