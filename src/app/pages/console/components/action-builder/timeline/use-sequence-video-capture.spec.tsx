// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSequenceVideoCapture, type SequenceVideoCaptureArgs } from "./use-sequence-video-capture";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";

const engine = vi.hoisted(() => ({
  isRecording: vi.fn(() => false),
  recordEditorPreview: vi.fn<(
    duration: number, onFrame: (ms: number) => void, signal: AbortSignal
  ) => Promise<Blob>>(),
}));

vi.mock("../../../3d/Viz3DProvider", () => ({ useViz3DContext: () => engine }));

const args = (): SequenceVideoCaptureArgs => ({
  sequence: { id: 1 } as ActionSequenceConfig,
  totalMs: 500,
  cursorMs: 123,
  onCursorMs: vi.fn(),
  pause: vi.fn(),
  liveMode: true,
  setLiveMode: vi.fn(),
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("完整播完草稿后恢复原游标和当前位置开关", async () => {
  const options = args();
  const blob = new Blob(["video"]);
  engine.recordEditorPreview.mockImplementationOnce(async (duration, setCursor) => {
    setCursor(0);
    setCursor(duration);
    return blob;
  });
  const { result } = renderHook(() => useSequenceVideoCapture(options));
  await act(async () => { expect(await result.current.capture()).toBe(blob); });
  expect(options.pause).toHaveBeenCalledOnce();
  expect(vi.mocked(options.onCursorMs).mock.calls).toEqual([[0], [500], [123]]);
  expect(vi.mocked(options.setLiveMode).mock.calls).toEqual([[false], [true]]);
  expect(result.current.capturing).toBe(false);
});

it("手动录制进行中不会扰动它或编辑器", async () => {
  const options = args();
  engine.isRecording.mockReturnValueOnce(true);
  const { result } = renderHook(() => useSequenceVideoCapture(options));
  await expect(result.current.capture()).rejects.toThrow("请先结束当前录制");
  expect(engine.recordEditorPreview).not.toHaveBeenCalled();
  expect(options.pause).not.toHaveBeenCalled();
});

it("切换序列时取消旧任务，不把旧游标写入新序列", async () => {
  const original = args();
  engine.recordEditorPreview.mockImplementationOnce((_duration, _onFrame, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  const { result, rerender } = renderHook(useSequenceVideoCapture, { initialProps: original });
  let capture!: Promise<Blob>;
  act(() => { capture = result.current.capture(); });
  const aborted = expect(capture).rejects.toMatchObject({ name: "AbortError" });
  await act(async () => {
    rerender({ ...original, sequence: { id: 2 } as ActionSequenceConfig });
  });
  await aborted;
  expect(original.onCursorMs).not.toHaveBeenCalled();
});
