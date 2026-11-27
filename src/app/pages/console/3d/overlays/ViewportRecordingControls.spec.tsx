// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Viz3DEngine } from "@/app/viz3d";
import { ViewportRecordingControls } from "./ViewportRecordingControls";

const clip = Object.assign(new Blob(["video frames"], { type: "video/webm" }), {
  arrayBuffer: async () => new TextEncoder().encode("video frames").buffer,
});
let engine: Viz3DEngine;

vi.mock("../Viz3DProvider", () => ({ useViz3DContext: () => engine }));
const saveVideo = vi.fn<(bytes: ArrayBuffer) => Promise<string | null>>();
const revealVideo = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  engine = new Viz3DEngine();
  vi.spyOn(engine, "startRecording").mockImplementation(() => {
    engine.events.emit("recordingState", { state: "recording" });
  });
  vi.spyOn(engine, "stopRecording").mockImplementation(async () => {
    engine.events.emit("recordingState", { state: "idle" });
    return clip;
  });
  vi.stubGlobal("recordingAPI", { saveVideo, revealVideo });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn((value: Blob) => value === clip ? "blob:recording" : "blob:export");
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const chooseViewMenuItem = (name: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: "视图菜单" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitem", { name }));
};

const recordClip = async () => {
  render(<ViewportRecordingControls />);
  expect(screen.queryByRole("button", { name: /开始录制|停止录制|查看导出/ })).toBeNull();
  chooseViewMenuItem("开始录制");
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "停止录制" }));
  return screen.findByRole("dialog", { name: "录制预览" });
};

it("停止后可播放录制，取消或保存失败可以重试并定位最终文件", async () => {
  saveVideo.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("磁盘空间不足"))
    .mockResolvedValueOnce("/tmp/舞台.webm");
  const dialog = await recordClip();
  await waitFor(() => expect(dialog.querySelector("video")?.getAttribute("src")).toBe("blob:recording"));

  const save = screen.getByRole("button", { name: "导出视频" });
  fireEvent.click(save);
  await waitFor(() => expect(saveVideo).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("磁盘空间不足");
  fireEvent.click(save);
  fireEvent.click(await screen.findByRole("button", { name: "在文件夹中显示" }));
  expect(revealVideo).toHaveBeenCalledWith("/tmp/舞台.webm");
  expect(engine.stopRecording).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording");
  expect(screen.queryByRole("button", { name: "停止录制" })).toBeNull();
  chooseViewMenuItem("查看导出");
  expect(await screen.findByText("/tmp/舞台.webm")).toBeTruthy();
});

it("可在新的控台会话中打开磁盘视频", async () => {
  render(<ViewportRecordingControls />);
  chooseViewMenuItem("查看导出");
  const file = new File(["previous recording"], "上次排练.webm", { type: "video/webm" });
  fireEvent.change(screen.getByLabelText("选择已导出的 WebM 视频"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText("视频回放").getAttribute("src")).toBe("blob:export"));
  expect(screen.getByText("上次排练.webm")).toBeTruthy();
  fireEvent.error(screen.getByLabelText("视频回放"));
  expect(screen.getByRole("alert").textContent).toContain("无法播放");
  expect(screen.queryByRole("button", { name: "导出视频" })).toBeNull();
});

it("回看磁盘视频后可以返回并导出原来的录制", async () => {
  await recordClip();
  const file = new File(["previous recording"], "上次排练.webm", { type: "video/webm" });
  fireEvent.change(screen.getByLabelText("选择已导出的 WebM 视频"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "返回本次录制" }));
  await waitFor(() => expect(screen.getByLabelText("视频回放").getAttribute("src")).toBe("blob:recording"));
  expect(screen.getByRole("button", { name: "导出视频" })).toBeTruthy();
});
