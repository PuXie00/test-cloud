import { useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { useViz3DContext } from "../../../3d/Viz3DProvider";
import { SequencePreviewContext } from "../../../hooks/sequence-preview-context";

export type SequenceVideoCaptureArgs = {
  sequence: ActionSequenceConfig | null;
  totalMs: number;
  cursorMs: number;
  onCursorMs: (ms: number) => void;
  pause: () => void;
  liveMode: boolean;
  setLiveMode: (enabled: boolean) => void;
};

export function useSequenceVideoCapture({
  sequence, totalMs, cursorMs, onCursorMs, pause, liveMode, setLiveMode,
}: SequenceVideoCaptureArgs) {
  const engine = useViz3DContext();
  const preview = useContext(SequencePreviewContext);
  const session = useRef<AbortController | null>(null);
  const currentSequence = useRef(sequence);
  currentSequence.current = sequence;
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => () => session.current?.abort(), [sequence, engine]);

  const capture = async (): Promise<Blob> => {
    if (!sequence || !Number.isFinite(totalMs) || totalMs <= 0) throw new Error("当前序列没有可导出的动作");
    if (preview?.sequenceId != null) throw new Error("请先结束当前节目预览");
    if (engine.isRecording() || session.current) throw new Error("请先结束当前录制");
    if (document.hidden) throw new Error("请在可见的 3D 视窗中导出");

    const controller = new AbortController();
    session.current = controller;
    const onHide = () => {
      if (document.hidden) controller.abort(new Error("视窗已隐藏，视频生成已中断"));
    };
    document.addEventListener("visibilitychange", onHide);
    setCapturing(true);
    setProgress(0);
    try {
      flushSync(() => {
        pause();
        if (liveMode) setLiveMode(false);
      });
      return await engine.recordEditorPreview(totalMs, (ms) => {
        // 在下一帧绘制前提交草稿游标和对应的 3D 位姿。
        flushSync(() => {
          onCursorMs(ms);
          setProgress(ms / totalMs);
        });
      }, controller.signal);
    } finally {
      document.removeEventListener("visibilitychange", onHide);
      if (currentSequence.current === sequence) onCursorMs(cursorMs);
      if (liveMode) setLiveMode(true);
      session.current = null;
      setCapturing(false);
    }
  };

  return { capture, cancel: () => session.current?.abort(), capturing, progress };
}
