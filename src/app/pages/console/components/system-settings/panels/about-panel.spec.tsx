// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeLicenseInfo, installFakeLicenseApi, uninstallFakeLicenseApi } from "@/app/license/install-fake-license-api";
import { LicenseProvider } from "@/app/license/license-provider";
import { AboutPanel } from "./about-panel";

afterEach(() => {
  cleanup();
  uninstallFakeLicenseApi();
});

const validState = {
  passed: true,
  info: fakeLicenseInfo("valid", {
    activatedAt: "2026-10-01 09:00:00",
    expireAt: "2027-10-01 00:00:00",
    graceUntil: "2026-11-03 09:00:00",
  }),
};

const renderPanel = () =>
  render(
    <LicenseProvider>
      <AboutPanel />
    </LicenseProvider>,
  );

describe("AboutPanel 授权管理", () => {
  it("显示 C++ 给的授权信息", async () => {
    installFakeLicenseApi(validState, {});
    renderPanel();
    expect(await screen.findByText("2027-10-01 00:00:00")).toBeTruthy();
    expect(screen.getByText("正常")).toBeTruthy();
  });

  it("「授权管理」打开和登录页同一个对话框：联网校验、换码续期", async () => {
    const api = installFakeLicenseApi(validState, {
      verify: [{ status: "valid", message: "校验成功" }],
      activate: [{ status: "valid", info: { expireAt: "2028-10-01 00:00:00" } }],
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "授权管理" }));
    const dialog = await screen.findByRole("dialog", { name: "软件授权管理" });

    fireEvent.click(within(dialog).getByRole("button", { name: "联网校验" }));
    expect(await within(dialog).findByText("校验成功")).toBeTruthy();
    expect(api.authVerify).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("tab", { name: "激活授权" }));
    fireEvent.change(within(dialog).getByLabelText("授权码"), { target: { value: "NEW-CODE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "激活" }));
    expect(await within(dialog).findByText("2028-10-01 00:00:00")).toBeTruthy();
    expect(api.authActivate).toHaveBeenCalledWith([{ code: "NEW-CODE" }]);
  });
});
