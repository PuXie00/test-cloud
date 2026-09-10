import type { RecordingOptions } from "../types";

const DEFAULT_FPS = 30;
const DEFAULT_MIME = "video/webm";

export const isRecordingSupported = (): boolean => {
  if (typeof MediaRecorder === "undefined") {
    return false;
  }
  try {
    return MediaRecorder.isTypeSupported(DEFAULT_MIME);
  } catch {
    return false;
  }
};

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = DEFAULT_MIME;

  start(canvas: HTMLCanvasElement, opts: RecordingOptions = {}): void {
    if (!isRecordingSupported()) {
      throw new Error("MediaRecorder not supported");
    }

    const fps = opts.fps ?? DEFAULT_FPS;
    this.mimeType = opts.mimeType ?? DEFAULT_MIME;
    const stream = canvas.captureStream(fps);

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: opts.videoBitsPerSecond,
    });

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      throw new Error("VideoRecorder is not active");
    }

    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.recorder = null;
        this.chunks = [];
        resolve(blob);
      };
      recorder.onerror = () => {
        reject(new Error("MediaRecorder failed"));
      };
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    });
  }

  isActive(): boolean {
    return this.recorder != null && this.recorder.state === "recording";
  }

  dispose(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stream.getTracks().forEach((track) => track.stop());
      try {
        this.recorder.stop();
      } catch {
        // ignore stop errors during dispose
      }
    }
    this.recorder = null;
    this.chunks = [];
  }
}
