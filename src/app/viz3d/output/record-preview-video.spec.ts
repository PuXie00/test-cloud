import { afterEach, expect, it, vi } from "vitest";
import { recordPreviewVideo } from "./record-preview-video";
import { VideoRecorder } from "./VideoRecorder";

afterEach(() => vi.restoreAllMocks());

const fixture = () => {
  let frame: ((now: number) => void) | undefined;
  const watch = (fn: (now: number) => void) => { frame = fn; return () => { frame = undefined; }; };
  const blob = new Blob(["render"]);
  const recorder = {
    start: vi.spyOn(VideoRecorder.prototype, "start").mockImplementation(() => {}),
    stop: vi.spyOn(VideoRecorder.prototype, "stop").mockResolvedValue(blob),
    dispose: vi.spyOn(VideoRecorder.prototype, "dispose").mockImplementation(() => {}),
  };
  const cursor = vi.fn();
  const controller = new AbortController();
  const recording = recordPreviewVideo({} as HTMLCanvasElement, 100, cursor, watch, controller.signal);
  return { frame: (now: number) => frame?.(now), recorder, recording, cursor, controller, blob };
};

it("第一帧渲染后才开录，末帧保持一个采样间隔后才结束", async () => {
  const t = fixture();
  expect(t.cursor).toHaveBeenCalledWith(0);
  expect(t.recorder.start).not.toHaveBeenCalled();
  t.frame(900);
  expect(t.recorder.start).toHaveBeenCalledOnce();
  // 请求开始与编码器确认开始之间可能相差数百毫秒。
  t.frame(1100);
  expect(t.cursor).toHaveBeenLastCalledWith(0);
  t.recorder.start.mock.calls[0][2]?.();
  t.frame(1200);
  t.frame(1245);
  expect(t.cursor).toHaveBeenLastCalledWith(45);
  t.frame(1305);
  expect(t.cursor).toHaveBeenLastCalledWith(100);
  expect(t.recorder.stop).not.toHaveBeenCalled();
  t.frame(1321);
  t.frame(1355);
  expect(await t.recording).toBe(t.blob);
});

it("取消时释放录制资源并停止推进游标", async () => {
  const t = fixture();
  t.frame(900);
  t.controller.abort();
  await expect(t.recording).rejects.toMatchObject({ name: "AbortError" });
  t.frame(1000);
  expect(t.recorder.dispose).toHaveBeenCalled();
  expect(t.cursor).toHaveBeenCalledTimes(1);
});
