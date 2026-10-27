// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DisplayLengthUnitProvider,
  useSessionDisplayLengthUnit,
} from "@/app/project/display-length-unit-provider";
import { AuthProvider } from "./auth-provider";
import { installFakeAuthApi, uninstallFakeAuthApi } from "./install-fake-auth-api";
import { Can, usePermissions } from "./permissions";
import { useAuth } from "./use-auth";

afterEach(() => {
  cleanup();
  uninstallFakeAuthApi();
});

let auth: ReturnType<typeof useAuth> | null = null;

const Probe = () => {
  auth = useAuth();
  const { can } = usePermissions();
  const unit = useSessionDisplayLengthUnit();
  return (
    <div>
      <span>用户：{auth.user?.displayName ?? "无"}</span>
      <span>单位：{unit}</span>
      <span>运行：{can("control.run") ? "可" : "不可"}</span>
      <Can permission="build.view">
        <span>搭建入口</span>
      </Can>
    </div>
  );
};

const renderApp = () =>
  render(
    <AuthProvider>
      <DisplayLengthUnitProvider>
        <Probe />
      </DisplayLengthUnitProvider>
    </AuthProvider>,
  );

describe("AuthProvider", () => {
  it("从主进程读回会话之前不渲染界面；刷新后仍是登录状态", async () => {
    installFakeAuthApi({ loggedIn: true, permissions: ["control.run"] });
    renderApp();
    expect(screen.queryByText(/用户：/)).toBeNull();
    expect(await screen.findByText("用户：王操")).toBeTruthy();
    expect(screen.getByText("运行：可")).toBeTruthy();
    expect(screen.queryByText("搭建入口")).toBeNull();
  });

  it("退出后一律没有权限，登录后按角色权限", async () => {
    installFakeAuthApi({ loggedIn: true, permissions: ["control.run", "build.view"] });
    renderApp();
    expect(await screen.findByText("搭建入口")).toBeTruthy();
    await act(async () => {
      await auth!.logout();
    });
    expect(screen.getByText("用户：无")).toBeTruthy();
    expect(screen.getByText("运行：不可")).toBeTruthy();
    expect(screen.queryByText("搭建入口")).toBeNull();
    await act(async () => {
      await auth!.login({ username: "op", password: "1234" });
    });
    expect(screen.getByText("搭建入口")).toBeTruthy();
  });

  it("显示单位跟着用户偏好走，改了立即生效", async () => {
    installFakeAuthApi({ loggedIn: true });
    renderApp();
    expect(await screen.findByText("单位：mm")).toBeTruthy();
    await act(async () => {
      await auth!.updatePreferences({ displayLengthUnit: "m" });
    });
    await waitFor(() => expect(screen.getByText("单位：m")).toBeTruthy());
  });
});
