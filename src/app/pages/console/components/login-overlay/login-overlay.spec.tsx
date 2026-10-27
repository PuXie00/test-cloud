// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/app/auth/auth-provider";
import { installFakeAuthApi, uninstallFakeAuthApi } from "@/app/auth/install-fake-auth-api";
import { ConsoleLoginProvider, useConsoleLogin } from "./console-login-context";
import { LoginOverlay } from "./login-overlay";

const { emergencyStopAll, allStopAll } = vi.hoisted(() => ({
  emergencyStopAll: vi.fn(),
  allStopAll: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../hooks/use-exec-cards", () => ({ useExecCardActions: () => ({ emergencyStopAll }) }));
vi.mock("../../hooks/plc-runtime-provider", () => ({ usePlcRuntime: () => ({ allStopAll }) }));
vi.mock("@/app/project/use-project", () => ({ useProject: () => ({ currentProject: { name: "天鹅湖" } }) }));

afterEach(() => {
  cleanup();
  uninstallFakeAuthApi();
  vi.clearAllMocks();
  localStorage.clear();
});

let consoleLogin: ReturnType<typeof useConsoleLogin> | null = null;
const Probe = () => {
  consoleLogin = useConsoleLogin();
  return <span>控制台内容</span>;
};

const renderConsole = async () => {
  render(
    <AuthProvider>
      <ConsoleLoginProvider>
        <Probe />
        <LoginOverlay />
      </ConsoleLoginProvider>
    </AuthProvider>,
  );
  await screen.findByText("控制台内容");
};

describe("控制台原地登录框", () => {
  it("没人登录时盖在控制台上，控制台不卸载；急停照常可点", async () => {
    installFakeAuthApi({ loggedIn: false });
    await renderConsole();
    expect(screen.getByRole("dialog", { name: "登录" })).toBeTruthy();
    expect(screen.getByText("控制台内容")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /急停/ }));
    expect(emergencyStopAll).toHaveBeenCalledTimes(1);
    expect(allStopAll).toHaveBeenCalledTimes(1);
  });

  it("登录框打开时背后的快捷键不响应", async () => {
    installFakeAuthApi({ loggedIn: false });
    await renderConsole();
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    window.removeEventListener("keydown", behind);
    expect(behind).not.toHaveBeenCalled();
  });

  it("退出登录：控制台原地显示登录框，登录后关闭", async () => {
    installFakeAuthApi({ loggedIn: true });
    await renderConsole();
    expect(screen.queryByRole("dialog")).toBeNull();
    localStorage.setItem("yz.auth.lastUsername", "op");
    await act(async () => {
      await consoleLogin!.logoutInPlace();
    });
    expect(screen.getByRole("dialog", { name: "登录" })).toBeTruthy();
    // 退出后多半是同一个人回来：预填上次的用户名
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("op");
    expect(screen.getByText("控制台内容")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "op" } });
    fireEvent.change(screen.getByLabelText("密码 / Password"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "登 录" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("切换用户可以取消，回到原用户", async () => {
    installFakeAuthApi({ loggedIn: true });
    await renderConsole();
    localStorage.setItem("yz.auth.lastUsername", "op");
    act(() => consoleLogin!.openSwitchUser());
    expect(screen.getByRole("dialog", { name: "切换用户" })).toBeTruthy();
    // 切换用户是换别人登录，不预填上次的用户名
    expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("当前用户：王操")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
