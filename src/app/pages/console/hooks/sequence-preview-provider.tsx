import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  hpyFromPositions,
  planStartTransition,
  type HpyPose,
} from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import {
  resolveActionSequence,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import { getMotionItemRepairIssue } from "@/app/project/project-motion-readiness";
import { useProject } from "@/app/project/use-project";
import { useConsoleNav } from "./use-console-nav";
import { useOptionalControlledObjects } from "./use-controlled-objects";
import { advancePreviewTimeline, buildPreviewTimeline } from "./sequence-preview-timeline";
import {
  SequencePreviewContext,
  type SequencePreviewMultiplier,
  type SequencePreviewState,
  type SequencePreviewValue,
  type StartPreviewOptions,
} from "./sequence-preview-context";

const PREVIEW_UNAVAILABLE = "动作序列无法预览";

const IDLE_STATE: SequencePreviewState = {
  sequenceId: null,
  cursorMs: 0,
  isPlaying: false,
  holdMode: false,
  faderPercent: 100,
  multiplier: 1,
  totalMs: 0,
  resolved: null,
  timeline: null,
};

export const SequencePreviewProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { currentProject } = useProject();
  const { activeNav } = useConsoleNav();
  const snapshots = useOptionalControlledObjects()?.snapshots;
  const [state, setState] = useState<SequencePreviewState>(IDLE_STATE);

  const stateRef = useRef(state);
  stateRef.current = state;

  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const cursorMsRef = useRef(state.cursorMs);
  const faderPercentRef = useRef(state.faderPercent);
  const multiplierRef = useRef(state.multiplier);
  const holdModeRef = useRef(state.holdMode);
  const timelineRef = useRef(state.timeline);
  cursorMsRef.current = state.cursorMs;
  faderPercentRef.current = state.faderPercent;
  multiplierRef.current = state.multiplier;
  holdModeRef.current = state.holdMode;
  timelineRef.current = state.timeline;

  const stopPreview = useCallback(() => {
    cursorMsRef.current = IDLE_STATE.cursorMs;
    faderPercentRef.current = IDLE_STATE.faderPercent;
    multiplierRef.current = IDLE_STATE.multiplier;
    holdModeRef.current = IDLE_STATE.holdMode;
    timelineRef.current = IDLE_STATE.timeline;
    setState(IDLE_STATE);
  }, []);

  const startPreview = useCallback((sequenceId: number, options?: StartPreviewOptions) => {
    const document = projectRef.current?.document;
    const sequence = document?.motion.actionSequences.find((entry) => entry.id === sequenceId);
    const issue = document ? getMotionItemRepairIssue(document, "sequence", sequenceId) : null;
    if (!document || !sequence || issue) {
      toast.warning(issue?.message ?? PREVIEW_UNAVAILABLE);
      return;
    }

    let resolved: ResolvedActionSequence;
    try {
      resolved = resolveActionSequence(sequence);
    } catch {
      toast.warning(PREVIEW_UNAVAILABLE);
      return;
    }

    const reverse = !!options?.reverse;
    const telemetryByObjectId = new Map<number, HpyPose>();
    for (const snapshot of snapshotsRef.current ?? []) {
      telemetryByObjectId.set(snapshot.descriptor.id, hpyFromPositions(snapshot.positions));
    }
    let plan: NearestStartPlan | null = null;
    try {
      plan = planStartTransition({
        resolved,
        sequence,
        objects: document.setup.controlledObjects,
        motors: document.setup.motors,
        telemetryByObjectId,
        nearest: !!options?.nearest,
        reverse,
      });
    } catch (error) {
      toast.warning(`过渡段无法预览：${error instanceof Error ? error.message : String(error)}`);
    }
    const timeline = buildPreviewTimeline(resolved.totalMs, plan, reverse);

    const next: SequencePreviewState = {
      sequenceId,
      cursorMs: 0,
      isPlaying: !!options?.autoplay,
      holdMode: !!options?.holdMode,
      faderPercent: options?.faderPercent ?? 100,
      multiplier: 1,
      totalMs: timeline.totalMs,
      resolved,
      timeline,
    };
    cursorMsRef.current = next.cursorMs;
    faderPercentRef.current = next.faderPercent;
    multiplierRef.current = next.multiplier;
    holdModeRef.current = next.holdMode;
    timelineRef.current = next.timeline;
    setState(next);
  }, []);

  const togglePreview = useCallback(
    (sequenceId: number, options?: StartPreviewOptions) => {
      const current = stateRef.current;
      if (current.sequenceId === sequenceId && !current.holdMode) {
        stopPreview();
        return;
      }
      startPreview(sequenceId, options);
    },
    [startPreview, stopPreview],
  );

  const setCursorMs = useCallback((ms: number) => {
    setState((current) => {
      if (current.sequenceId === null) return current;
      const cursorMs = Math.min(current.totalMs, Math.max(0, ms));
      cursorMsRef.current = cursorMs;
      return { ...current, cursorMs };
    });
  }, []);

  const play = useCallback(() => {
    setState((current) => {
      if (current.sequenceId === null) return current;
      if (current.totalMs > 0 && current.cursorMs >= current.totalMs) {
        cursorMsRef.current = 0;
        return { ...current, cursorMs: 0, isPlaying: true };
      }
      return { ...current, isPlaying: true };
    });
  }, []);

  const pause = useCallback(() => {
    setState((current) => (current.sequenceId === null ? current : { ...current, isPlaying: false }));
  }, []);

  const setMultiplier = useCallback((m: SequencePreviewMultiplier) => {
    multiplierRef.current = m;
    setState((current) => ({ ...current, multiplier: m }));
  }, []);

  useEffect(() => {
    if (!state.isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dtMs = now - last;
      last = now;
      const timeline = timelineRef.current;
      if (!timeline) return;
      const advanced = advancePreviewTimeline({
        timeline,
        cursorMs: cursorMsRef.current,
        dtMs,
        faderPercent: faderPercentRef.current,
        multiplier: multiplierRef.current,
        loop: holdModeRef.current,
      });
      cursorMsRef.current = advanced.cursorMs;
      timelineRef.current = advanced.timeline;
      const patch = {
        cursorMs: advanced.cursorMs,
        timeline: advanced.timeline,
        totalMs: advanced.timeline.totalMs,
      };
      if (advanced.ended) {
        setState((current) => ({ ...current, ...patch, isPlaying: false }));
        return;
      }
      setState((current) => ({ ...current, ...patch }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [state.isPlaying]);

  useEffect(() => {
    if (activeNav !== "control" && activeNav !== "sequences") stopPreview();
  }, [activeNav, stopPreview]);

  const prevProjectIdRef = useRef<string | undefined>(undefined);
  const skipProjectIdEffectRef = useRef(true);
  useEffect(() => {
    const projectId = currentProject?.id;
    if (skipProjectIdEffectRef.current) {
      skipProjectIdEffectRef.current = false;
      prevProjectIdRef.current = projectId;
      return;
    }
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      stopPreview();
    }
  }, [currentProject?.id, stopPreview]);

  const actionSequences = currentProject?.document?.motion.actionSequences;
  useEffect(() => {
    const sequenceId = stateRef.current.sequenceId;
    if (sequenceId === null) return;
    const exists = actionSequences?.some((sequence) => sequence.id === sequenceId) ?? false;
    if (!exists) stopPreview();
  }, [actionSequences, stopPreview, state.sequenceId]);

  const value = useMemo<SequencePreviewValue>(
    () => ({
      ...state,
      startPreview,
      togglePreview,
      stopPreview,
      setCursorMs,
      play,
      pause,
      setMultiplier,
    }),
    [state, startPreview, togglePreview, stopPreview, setCursorMs, play, pause, setMultiplier],
  );

  return <SequencePreviewContext.Provider value={value}>{children}</SequencePreviewContext.Provider>;
};
