// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateDownloadProgress, UpdateStatus } from "@shared/update/types";
import type { UpdateAPI } from "@/types/electron";
import { UpdatePanel } from "./update-panel";

const motion = vi.hoisted(() => ({ movingAxisIds: [] as number[] }));
vi.mock("../../../hooks/axis-motion", () => ({ useAxisMotion: () => motion }));

const baseStatus = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  currentVersion: "1.1.0",
  installSupported: true,
  signingKeyConfigured: true,
  onlineUrl: null,
  packages: [
    { version: "1.2.0", releasedAt: "2026-11-20T08:00:00.000Z", notes: "新功能", sizeBytes: 150 * 1024 * 1024, relation: "newer" },
    { version: "1.1.0", releasedAt: "2026-11-01T08:00:00.000Z", notes: "", sizeBytes: 1, relation: "current" },
    { version: "1.0.0", releasedAt: "2026-10-01T08:00:00.000Z", notes: "", sizeBytes: 1, relation: "older" },
  ],
  download: null,
  ...patch,
});

let progressListener: ((progress: UpdateDownloadProgress | null) => void) | null = null;

const installApi = (status: UpdateStatus) => {
  const api = {
    status: vi.fn(async () => ({ ok: true as const, data: status })),
    importPackage: vi.fn(async () => ({ ok: false as const, code: "CANCELLED", message: "已取消" })),
    check: vi.fn(async () => ({
      ok: true as const,
      data: {
        latest: {
          version: "1.3.0",
          releasedAt: "2026-12-01T00:00:00.000Z",
          notes: "修了很多问题",
          file: "yzapp_1.3.0.yzupd",
          size: 1024 * 1024,
          sha512: "x",
        },
        relation: "newer" as const,
        stored: false,
      },
    })),
    download: vi.fn(() => new Promise<never>(() => undefined)),
    cancelDownload: vi.fn(async () => ({ ok: true as const, data: null })),
    install: vi.fn(async () => ({ ok: true as const, data: null })),
    onProgress: vi.fn((listener: (progress: UpdateDownloadProgress | null) => void) => {
      progressListener = listener;
      return () => {
        progressListener = null;
      };
    }),
  } satisfies UpdateAPI;
  window.updateAPI = api;
  return api;
};

const confirm = vi.fn(async () => true);

beforeEach(() => {
  motion.movingAxisIds = [];
  confirm.mockClear();
  window.toolAPI = { confirm } as unknown as typeof window.toolAPI;
});

afterEach(() => {
  cleanup();
  delete window.updateAPI;
  progressListener = null;
});

describe("软件更新", () => {
  it("列出本机升级包：新的能装，旧的能回退，当前版本没有按钮", async () => {
    installApi(baseStatus());
    render(<UpdatePanel />);
    expect(await screen.findAllByText("v1.1.0")).toHaveLength(2);
    expect(screen.getByText("可升级")).toBeTruthy();
    expect(screen.getByText("当前版本")).toBeTruthy();
    expect(screen.getByText("可回退")).toBeTruthy();
    expect(screen.getByRole("button", { name: "安装" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "回退到此版本" })).toBeTruthy();
    expect(screen.getByText("新功能")).toBeTruthy();
    expect(screen.getByText(/还没有配置更新服务器/)).toBeTruthy();
  });

  it("安装：确认后交给主进程", async () => {
    const api = installApi(baseStatus());
    render(<UpdatePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "安装" }));
    await waitFor(() => expect(api.install).toHaveBeenCalledWith({ version: "1.2.0" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "安装升级", message: "升级到 v1.2.0？" }));
  });

  it("回退：提醒新版本存的工程会显示版本过高", async () => {
    const api = installApi(baseStatus());
    render(<UpdatePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "回退到此版本" }));
    await waitFor(() => expect(api.install).toHaveBeenCalledWith({ version: "1.0.0" }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "回退版本", danger: true, detail: expect.stringContaining("版本过高") }),
    );
  });

  it("有轴在动时不装，也不问", async () => {
    motion.movingAxisIds = [3, 5];
    const api = installApi(baseStatus());
    render(<UpdatePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "安装" }));
    await act(async () => undefined);
    expect(confirm).not.toHaveBeenCalled();
    expect(api.install).not.toHaveBeenCalled();
  });

  it("没配签名公钥：提示，不能导入也不能装", async () => {
    installApi(baseStatus({ signingKeyConfigured: false }));
    render(<UpdatePanel />);
    expect(await screen.findByText(/没有配置升级签名公钥/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /选择升级包/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "安装" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("在线更新：检查、下载并显示进度", async () => {
    const api = installApi(baseStatus({ onlineUrl: "https://updates.example.com/yzapp/" }));
    render(<UpdatePanel />);
    fireEvent.click(await screen.findByRole("button", { name: /检查更新/ }));
    expect(await screen.findByText("发现新版本 v1.3.0")).toBeTruthy();
    expect(screen.getByText("修了很多问题")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    expect(api.download).toHaveBeenCalled();
    act(() => progressListener?.({ version: "1.3.0", received: 512 * 1024, total: 1024 * 1024 }));
    expect(screen.getByText("v1.3.0 50%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消下载" }));
    expect(api.cancelDownload).toHaveBeenCalled();
  });
});
