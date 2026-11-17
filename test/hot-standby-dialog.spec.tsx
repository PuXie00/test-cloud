// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HaSettings, HaState } from "../shared/ha/types";
import { TestPermissionsProvider } from "../src/app/auth/permissions";
import { HaStateProvider } from "../src/app/hot-standby/ha-state-provider";
import { HotStandbyDialog } from "../src/app/pages/console/components/hot-standby/hot-standby-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Radix ScrollArea / Select 在 jsdom 里要这几个
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const settings: HaSettings = {
  role: "standby",
  hostName: "控台-B",
  localIp: "192.168.0.101",
  primaryIp: "192.168.0.100",
  syncScope: { motion: true, rules: true, meta: true, models: true },
};

const baseState: HaState = {
  enabled: false,
  role: "standby",
  hostName: "控台-B",
  localIp: "192.168.0.101",
  primaryIp: "192.168.0.100",
  localProject: { id: "p-1", name: "演出", formatVersion: 1 },
  peers: [],
  deviceGate: null,
  error: null,
};

const installApi = (state: HaState) => {
  let listener: ((next: HaState) => void) | null = null;
  const api = {
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (next: HaSettings) => ({ ok: true as const, data: next })),
    listLocalIps: vi.fn(async () => [{ address: "192.168.0.101", iface: "eth0" }]),
    getState: vi.fn(async () => state),
    start: vi.fn(async () => ({ ok: true as const, data: { ...state, enabled: true } })),
    stop: vi.fn(async () => ({ ok: true as const, data: { ...state, enabled: false } })),
    onState: (next: (value: HaState) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  window.haAPI = api;
  return { api, push: (next: HaState) => listener?.(next) };
};

const renderDialog = (permissions: "collab.manage"[] = ["collab.manage"]) =>
  render(
    <TestPermissionsProvider permissions={permissions}>
      <HaStateProvider>
        <HotStandbyDialog open onOpenChange={() => undefined} />
      </HaStateProvider>
    </TestPermissionsProvider>,
  );

afterEach(() => {
  cleanup();
  delete window.haAPI;
});

describe("HotStandbyDialog", () => {
  it("loads the saved settings and starts hot standby", async () => {
    const { api } = installApi(baseState);
    renderDialog();
    await waitFor(() => expect((screen.getByLabelText("本机名称") as HTMLInputElement).value).toBe("控台-B"));
    expect((screen.getByLabelText("主机 IP") as HTMLInputElement).value).toBe("192.168.0.100");
    expect(screen.getByText("备机跟随主机的同步范围。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "开启热备" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("saves edited settings before starting", async () => {
    const { api } = installApi(baseState);
    renderDialog();
    const name = await screen.findByLabelText("本机名称");
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("控台-B"));
    fireEvent.change(name, { target: { value: "控台-C" } });
    fireEvent.click(screen.getByRole("button", { name: "开启热备" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.saveSettings).toHaveBeenCalledWith({ ...settings, hostName: "控台-C" });
  });

  it("locks role, name and IP while on and shows the link and the standby gate", async () => {
    const { push } = installApi(baseState);
    renderDialog();
    await screen.findByLabelText("本机名称");
    push({
      ...baseState,
      enabled: true,
      peers: [
        {
          ip: "192.168.0.100",
          link: "up",
          hostName: "控台-A",
          role: "primary",
          project: { id: "p-1", name: "演出", formatVersion: 1 },
          versionMismatch: false,
          closedByPeer: false,
        },
      ],
      deviceGate: "还没和主机核对完成，只能停止、急停",
    });
    await screen.findByRole("button", { name: "关闭热备" });
    expect((screen.getByLabelText("本机名称") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("主机 IP") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("同一个工程「演出」")).toBeTruthy();
    expect(screen.getByText("还没和主机核对完成，只能停止、急停")).toBeTruthy();
  });

  it("is read-only without the permission", async () => {
    installApi(baseState);
    renderDialog([]);
    await waitFor(() => expect((screen.getByLabelText("本机名称") as HTMLInputElement).value).toBe("控台-B"));
    expect((screen.getByRole("button", { name: "开启热备" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("本机名称") as HTMLInputElement).disabled).toBe(true);
  });
});
