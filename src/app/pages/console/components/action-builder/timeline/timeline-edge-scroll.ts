import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { pxToMs } from "./timeline-data";
import { clampViewStartMs } from "./timeline-view-extent";

/** 离时间区左右边这么近就开始滚（窗口贴着屏幕边时指针出不去，也能滚） */
export const EDGE_SCROLL_ZONE_PX = 16;
const EDGE_SCROLL_MIN_STEP_PX = 2;
const EDGE_SCROLL_MAX_STEP_PX = 30;
const EDGE_SCROLL_GAIN = 0.3;

/**
 * 拖动时每一帧视图滚多少像素：指针进了左右边的贴边区（或出了时间区）才滚，
 * 越往外越快；往左为负。不用滚时为 0。
 */
export const edgeScrollStepPx = (clientX: number, bounds: { left: number; right: number }): number => {
  const leftDepth = bounds.left + EDGE_SCROLL_ZONE_PX - clientX;
  const rightDepth = clientX - (bounds.right - EDGE_SCROLL_ZONE_PX);
  const depth = Math.max(leftDepth, rightDepth);
  if (!(depth > 0) || bounds.right - bounds.left <= EDGE_SCROLL_ZONE_PX * 2) return 0;
  const step = Math.min(EDGE_SCROLL_MAX_STEP_PX, EDGE_SCROLL_MIN_STEP_PX + depth * EDGE_SCROLL_GAIN);
  return leftDepth > rightDepth ? -step : step;
};

/** 一次拖动的贴边滚动：shiftMs 是这次拖动以来视图滚过的毫秒（往右为正） */
export type EdgeScrollSession = { shiftMs: () => number; end: () => void };

/** 拖块、拖游标时开一次；onScroll 在视图滚了之后调，用最后的指针位置重算一遍拖动 */
export type EdgeScrollBegin = (onScroll?: () => void) => EdgeScrollSession;

const NO_SESSION: EdgeScrollSession = { shiftMs: () => 0, end: () => {} };

export const TimelineEdgeScrollContext = createContext<EdgeScrollBegin | null>(null);

/** 时间轴里的拖动用：不在时间轴里（单独渲染的块）时不滚 */
export const useTimelineEdgeScroll = (): EdgeScrollBegin => {
  const begin = useContext(TimelineEdgeScrollContext);
  return begin ?? (() => NO_SESSION);
};

const scheduleFrame = (callback: () => void): (() => void) => {
  if (typeof window.requestAnimationFrame === "function") {
    const id = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(id);
  }
  const id = window.setTimeout(callback, 16);
  return () => window.clearTimeout(id);
};

/**
 * 贴边自动滚：拖动开始时 begin，指针在左右边附近时每帧平移视图，松手停。
 * 视图起点从 getViewStartMs 读最新值，滚完用 setViewStartMs 写回（要同步更新拖动读的那份）。
 */
export const useEdgeScrollController = (input: {
  getBounds: () => { left: number; right: number } | null;
  getViewStartMs: () => number;
  setViewStartMs: (ms: number) => void;
  pxPerSecond: number;
}): EdgeScrollBegin => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const activeRef = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      for (const end of [...activeRef.current]) end();
    },
    [],
  );

  return useCallback((onScroll?: () => void) => {
    let clientX: number | null = null;
    let shiftMs = 0;
    let cancelFrame: (() => void) | null = null;
    let ended = false;

    const tick = () => {
      cancelFrame = null;
      if (ended || clientX === null) return;
      const { getBounds, getViewStartMs, setViewStartMs, pxPerSecond } = inputRef.current;
      const bounds = getBounds();
      const stepPx = bounds ? edgeScrollStepPx(clientX, bounds) : 0;
      if (stepPx === 0) return;
      const current = getViewStartMs();
      const next = clampViewStartMs(current + pxToMs(stepPx, pxPerSecond));
      if (next !== current) {
        setViewStartMs(next);
        shiftMs += next - current;
        onScroll?.();
      }
      // 到了最左边还往左：不再滚，指针往回移时再开始
      if (next === current && stepPx < 0) return;
      cancelFrame = scheduleFrame(tick);
    };

    // 下一帧再滚：这一下移动先由拖动自己处理完，滚了之后 onScroll 再按新视图重算
    const handleMove = (event: PointerEvent) => {
      clientX = event.clientX;
      if (cancelFrame !== null || ended) return;
      const bounds = inputRef.current.getBounds();
      if (bounds && edgeScrollStepPx(clientX, bounds) !== 0) cancelFrame = scheduleFrame(tick);
    };

    const end = () => {
      if (ended) return;
      ended = true;
      cancelFrame?.();
      cancelFrame = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      activeRef.current.delete(end);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    activeRef.current.add(end);
    return { shiftMs: () => shiftMs, end };
  }, []);
};
