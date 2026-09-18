import { useCallback, useEffect, useRef, useState } from "react";
import { advancePreviewCursor } from "../../../hooks/sequence-preview";

export type TimelinePlaybackArgs = {
  cursorMs: number;
  totalMs: number;
  onCursorMs: (ms: number) => void;
  pauseKey?: unknown;
};

export const useTimelinePlayback = ({
  cursorMs,
  totalMs,
  onCursorMs,
  pauseKey,
}: TimelinePlaybackArgs) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const cursorMsRef = useRef(cursorMs);
  const totalMsRef = useRef(totalMs);
  const onCursorMsRef = useRef(onCursorMs);
  cursorMsRef.current = cursorMs;
  totalMsRef.current = totalMs;
  onCursorMsRef.current = onCursorMs;

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (totalMsRef.current <= 0) return;
    if (cursorMsRef.current >= totalMsRef.current) {
      cursorMsRef.current = 0;
      onCursorMsRef.current(0);
    }
    setIsPlaying(true);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  useEffect(() => {
    setIsPlaying(false);
  }, [pauseKey]);

  useEffect(() => {
    if (totalMs <= 0) setIsPlaying(false);
  }, [totalMs]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const advanced = advancePreviewCursor({
        cursorMs: cursorMsRef.current,
        dtMs: now - last,
        faderPercent: 100,
        multiplier: 1,
        totalMs: totalMsRef.current,
        loop: false,
      });
      last = now;
      cursorMsRef.current = advanced.cursorMs;
      onCursorMsRef.current(advanced.cursorMs);
      if (advanced.ended) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  return { isPlaying, play, pause, toggle };
};
