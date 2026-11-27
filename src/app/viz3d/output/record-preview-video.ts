import { VideoRecorder } from "./VideoRecorder";

const FPS = 30;
type OnFrame = (time: number) => void;

/** 先摆好首帧，再按真实渲染时钟播放一次。末帧至少保留一个视频采样间隔。 */
export async function recordPreviewVideo(
  canvas: HTMLCanvasElement,
  durationMs: number,
  setCursor: (ms: number) => void,
  watchRenderedFrames: (callback: OnFrame) => () => void,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  let recorder: VideoRecorder | undefined;
  let unwatch: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const capture = new VideoRecorder(reject);
      recorder = capture;
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      setCursor(0);

      let requested = false;
      let encoderReady = false;
      let startedAt: number | undefined;
      let atEnd = false;
      let lastPoseRenderedAt: number | undefined;
      unwatch = watchRenderedFrames((now) => {
        try {
          if (!requested) {
            requested = true;
            capture.start(canvas, { fps: FPS }, () => { encoderReady = true; });
            return;
          }
          // MediaRecorder.start() 返回时编码器可能还在初始化，期间须保留首帧。
          if (!encoderReady) return;
          startedAt ??= now;
          if (!atEnd) {
            const cursor = Math.min(now - startedAt, durationMs);
            setCursor(cursor);
            atEnd = cursor === durationMs;
            return;
          }
          lastPoseRenderedAt ??= now;
          if (now - lastPoseRenderedAt >= 1000 / FPS) {
            unwatch?.();
            unwatch = undefined;
            capture.stop().then(resolve, reject);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    unwatch?.();
    if (onAbort) signal.removeEventListener("abort", onAbort);
    recorder?.dispose();
  }
}
