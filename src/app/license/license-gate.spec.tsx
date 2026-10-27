// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseAck, LicenseInfo, LicenseState, LicenseStatus } from "@shared/csocket/license";
import { LicenseGate } from "./license-gate";
import { LicenseProvider } from "./license-provider";

const info = (status: LicenseStatus, extra: Partial<LicenseInfo> = {}): LicenseInfo => ({
  status,
  statusCode: { inactive: 0, needVerify: 1, expired: 2, valid: 3, unknown: 9 }[status],
  activatedAt: "",
  expireAt: "",
  graceUntil: "",
  message: "",
  ...extra,
});

type Reply = { status?: LicenseStatus; info?: Partial<LicenseInfo>; success?: boolean; message?: string; error?: string };

/** 假的 window.csocketApi 授权指令：每次调用按给定的回复改状态（规则和主进程一致：正常就放行） */
const installFakeLicenseApi = (
  initial: Partial<LicenseState>,
  replies: Partial<Record<"check" | "activate" | "verify", Reply[]>>,
) => {
  let state: LicenseState = { passed: false, skipped: false, devSkipAllowed: false, info: null, ...initial };
  const answer = (kind: "check" | "activate" | "verify") => async (): Promise<LicenseAck> => {
    const reply = replies[kind]?.shift();
    if (!reply) throw new Error(`no reply for ${kind}`);
    if (reply.error) return { success: false, code: "ACK_TIMEOUT", message: reply.error, data: [state] };
    if (reply.status) {
      state = { ...state, info: info(reply.status, reply.info) };
      if (reply.status === "valid") state = { ...state, passed: true };
    }
    return { success: reply.success ?? true, code: 100, message: reply.message ?? "", data: [state] };
  };
  const api = {
    getLicenseSnapshot: vi.fn(async (): Promise<LicenseAck> => ({ success: true, data: [state] })),
    authLocalStatus: vi.fn(answer("check")),
    authActivate: vi.fn(answer("activate")),
    authVerify: vi.fn(answer("verify")),
    authSkip: vi.fn(async (): Promise<LicenseAck> => {
      state = { ...state, passed: true, skipped: true };
      return { success: true, message: "", data: [state] };
    }),
    onLicense: vi.fn(() => () => undefined),
  };
  window.csocketApi = api as unknown as Window["csocketApi"];
  return api;
};

const renderGate = () =>
  render(
    <LicenseProvider>
      <LicenseGate>
        <p>登录页</p>
      </LicenseGate>
    </LicenseProvider>,
  );

afterEach(() => {
  cleanup();
  delete (window as { csocketApi?: unknown }).csocketApi;
});

describe("LicenseGate", () => {
  it("没有 csocketApi（测试 / 浏览器）时不拦", () => {
    renderGate();
    expect(screen.getByText("登录页")).toBeTruthy();
  });

  it("本次运行已放行（渲染进程刷新）不再查", async () => {
    const api = installFakeLicenseApi({ passed: true, info: info("valid") }, {});
    renderGate();
    expect(await screen.findByText("登录页")).toBeTruthy();
    expect(api.authLocalStatus).not.toHaveBeenCalled();
  });

  it("正常直接进入", async () => {
    installFakeLicenseApi({}, { check: [{ status: "valid" }] });
    renderGate();
    expect(await screen.findByText("登录页")).toBeTruthy();
  });

  it("未激活：输入授权码激活，失败显示 C++ 的原因，成功进入", async () => {
    const api = installFakeLicenseApi(
      {},
      {
        check: [{ status: "inactive", success: false, info: { message: "未激活，请输入授权码激活。" } }],
        activate: [
          { status: "inactive", success: false, message: "激活失败：授权码不存在" },
          { status: "valid" },
        ],
      },
    );
    renderGate();
    expect(await screen.findByText("软件未激活")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "激活" }));
    expect(await screen.findByText("请输入授权码")).toBeTruthy();
    expect(api.authActivate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("授权码"), { target: { value: "1111-1111-1111-1111" } });
    fireEvent.click(screen.getByRole("button", { name: "激活" }));
    expect((await screen.findByRole("alert")).textContent).toBe("激活失败：授权码不存在");
    expect(api.authActivate).toHaveBeenCalledWith([{ code: "1111-1111-1111-1111" }]);

    fireEvent.click(screen.getByRole("button", { name: "激活" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
  });

  it("离线超期：自动联网校验，失败可重试", async () => {
    const api = installFakeLicenseApi(
      {},
      {
        check: [{ status: "needVerify", info: { graceUntil: "2026-10-20" } }],
        verify: [{ error: "联网校验超时：没有收到授权服务器的回复，请检查网络后重试" }, { status: "valid" }],
      },
    );
    renderGate();
    expect(await screen.findByText("需要联网校验授权")).toBeTruthy();
    expect(screen.getByText(/离线可用至 2026-10-20/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("联网校验超时");
    expect(api.authVerify).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重新校验" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
    expect(api.authVerify).toHaveBeenCalledTimes(2);
  });

  it("已过期：显示到期日，重新激活", async () => {
    installFakeLicenseApi(
      {},
      { check: [{ status: "expired", info: { expireAt: "2026-10-01" } }], activate: [{ status: "valid" }] },
    );
    renderGate();
    expect(await screen.findByText("授权已过期")).toBeTruthy();
    expect(screen.getByText(/授权已于 2026-10-01 到期/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("授权码"), { target: { value: "NEW-CODE" } });
    fireEvent.click(screen.getByRole("button", { name: "激活" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
  });

  it("激活后 C++ 说还要联网校验：接着校验", async () => {
    const api = installFakeLicenseApi(
      {},
      { check: [{ status: "inactive" }], activate: [{ status: "needVerify" }], verify: [{ status: "valid" }] },
    );
    renderGate();
    fireEvent.change(await screen.findByLabelText("授权码"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "激活" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
    expect(api.authVerify).toHaveBeenCalledTimes(1);
  });

  it("连不上控制服务：可重试，正式版没有跳过", async () => {
    const api = installFakeLicenseApi(
      {},
      { check: [{ error: "连接不上控制服务（YzRuntime），读取不到授权状态" }, { status: "valid" }] },
    );
    renderGate();
    expect(await screen.findByText("读取不到授权状态")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "跳过（开发模式）" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
    expect(api.authLocalStatus).toHaveBeenCalledTimes(2);
  });

  it("开发模式连不上时可以跳过", async () => {
    installFakeLicenseApi({ devSkipAllowed: true }, { check: [{ error: "连接不上控制服务" }] });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: "跳过（开发模式）" }));
    expect(await screen.findByText("登录页")).toBeTruthy();
  });
});
