// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoExportDialog } from "./VideoExportDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("同一弹窗从动作序列生成进度切到可保存的预览，下一段可独立导出", async () => {
  const path = "/tmp/动作序列.webm";
  const saveVideo = vi.fn().mockResolvedValue(path);
  vi.stubGlobal("recordingAPI", { saveVideo });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = () => "blob:preview";
    static revokeObjectURL = () => {};
  });

  const show = (clip: Blob | null) => (
    <VideoExportDialog open onOpenChange={() => {}} title="动作序列预览视频" clip={clip}>
      正在生成预览
    </VideoExportDialog>
  );
  const { rerender } = render(show(null));
  const dialog = screen.getByRole("dialog", { name: "动作序列预览视频" });
  expect(dialog.textContent).toContain("正在生成预览");
  expect(screen.queryByRole("button", { name: "导出视频" })).toBeNull();

  const take = () => Object.assign(new Blob(["video"], { type: "video/webm" }), {
    arrayBuffer: async () => new TextEncoder().encode("video").buffer,
  });
  rerender(show(take()));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.queryByText("正在生成预览")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
  expect(await screen.findByText(path)).toBeTruthy();
  expect(saveVideo).toHaveBeenCalledOnce();

  rerender(show(take()));
  await waitFor(() => expect(screen.getByRole("button", { name: "导出视频" })).toBeTruthy());
  expect(screen.queryByText(path)).toBeNull();
});
