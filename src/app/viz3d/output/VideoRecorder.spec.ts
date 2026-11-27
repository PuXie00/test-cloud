import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoRecorder } from "./VideoRecorder";

class TestMediaRecorder {
  static isTypeSupported = () => true;
  static latest: TestMediaRecorder;
  state = "inactive";
  mimeType = "video/webm;codecs=vp8";
  ondataavailable?: (event: { data: Blob }) => void;
  onerror?: () => void;
  onstop?: () => void;

  constructor(readonly stream: MediaStream) { TestMediaRecorder.latest = this; }
  start = vi.fn(() => { this.state = "recording"; });
  stop() { this.state = "inactive"; }

  finish(text: string) {
    this.stop();
    this.ondataavailable?.({ data: new Blob([text]) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const canvas = {
  captureStream: () => ({ getTracks: () => [{ stop: stopTrack }] }),
} as unknown as HTMLCanvasElement;

beforeEach(() => {
  stopTrack.mockClear();
  vi.stubGlobal("MediaRecorder", TestMediaRecorder);
});
afterEach(() => vi.unstubAllGlobals());

describe("3D 视窗录制", () => {
  it("收到最终数据后才释放轨道，停止完成前不能开始另一段", async () => {
    const recorder = new VideoRecorder();
    recorder.start(canvas);
    const media = TestMediaRecorder.latest;
    expect(media.start).toHaveBeenCalledWith();
    media.ondataavailable?.({ data: new Blob(["first"]) });
    const result = recorder.stop();
    expect(() => recorder.start(canvas)).toThrow();
    expect(stopTrack).not.toHaveBeenCalled();
    media.finish("last");
    expect(await (await result).text()).toBe("firstlast");
    expect((await result).type).toBe(media.mimeType);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("编码器中断时发出错误，释放轨道后可以重新录制", async () => {
    const onError = vi.fn();
    const recorder = new VideoRecorder(onError);
    recorder.start(canvas);
    TestMediaRecorder.latest.onerror?.();
    expect(onError).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    recorder.start(canvas);
    const result = recorder.stop();
    TestMediaRecorder.latest.finish("ok");
    expect(await (await result).text()).toBe("ok");
  });

  it("空视频和停止期间卸载都拒绝导出并释放轨道", async () => {
    const recorder = new VideoRecorder();
    recorder.start(canvas);
    const empty = recorder.stop();
    TestMediaRecorder.latest.finish("");
    await expect(empty).rejects.toThrow();
    recorder.start(canvas);
    const interrupted = recorder.stop();
    recorder.dispose();
    await expect(interrupted).rejects.toThrow();
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it("创建编码器失败也释放已经开始捕获的轨道", () => {
    vi.stubGlobal("MediaRecorder", class extends TestMediaRecorder {
      constructor(stream: MediaStream) { super(stream); throw new Error("encoder unavailable"); }
    });
    expect(() => new VideoRecorder().start(canvas)).toThrow("encoder unavailable");
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
