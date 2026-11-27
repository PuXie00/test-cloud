import type { RecordingOptions } from "../types";

const DEFAULT_FPS = 30;
const DEFAULT_MIME = "video/webm";

export const isRecordingSupported = (mimeType = DEFAULT_MIME): boolean =>
  typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType);

const stopTracks = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private pendingStop: { resolve: (blob: Blob) => void; reject: (error: Error) => void } | null = null;

  constructor(private readonly onError?: (error: Error) => void) {}

  start(canvas: HTMLCanvasElement, opts: RecordingOptions = {}, onStarted?: () => void): void {
    if (this.recorder) throw new Error("上一段录制尚未结束");
    const mimeType = opts.mimeType ?? DEFAULT_MIME;
    if (!isRecordingSupported(mimeType) || typeof canvas.captureStream !== "function") {
      throw new Error("当前环境不支持视窗录制");
    }
    const stream = canvas.captureStream(opts.fps ?? DEFAULT_FPS);
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: opts.videoBitsPerSecond });
      const chunks: Blob[] = [];
      recorder.onstart = onStarted ?? null;
      recorder.ondataavailable = ({ data }) => {
        if (data.size > 0) chunks.push(data);
      };
      recorder.onerror = () => this.fail(new Error("视频编码失败，请重新录制"));
      recorder.onstop = () => {
        if (!this.pendingStop) {
          this.fail(new Error("视窗录制意外中断"));
          return;
        }
        if (!chunks.length) {
          this.fail(new Error("未录到视频帧，请重新录制"));
          return;
        }
        const { resolve } = this.pendingStop;
        this.release();
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      };
      // 一次交付完整文件，让 Chromium 在结束时写入 WebM 时长和定位索引。
      recorder.start();
      this.recorder = recorder;
    } catch (error) {
      stopTracks(stream);
      throw error;
    }
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive" || this.pendingStop) {
      throw new Error("当前没有可停止的录制");
    }
    return new Promise<Blob>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
      try {
        recorder.stop();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  isActive(): boolean {
    return this.recorder?.state === "recording";
  }

  dispose(): void {
    this.pendingStop?.reject(new Error("视窗已关闭，录制已中断"));
    this.release();
  }

  private fail(error: Error): void {
    this.pendingStop?.reject(error);
    this.release();
    this.onError?.(error);
  }

  private release(): void {
    const recorder = this.recorder;
    this.recorder = null;
    this.pendingStop = null;
    if (recorder) {
      recorder.onstart = null;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      stopTracks(recorder.stream);
    }
  }
}
