import { vi } from "vitest";
import type { LicenseAck, LicenseInfo, LicenseState, LicenseStatus } from "@shared/csocket/license";

/** 测试用的 window.csocketApi 授权指令（完整规则在主进程 CsocketApiService 的测试里） */
export const fakeLicenseInfo = (status: LicenseStatus, extra: Partial<LicenseInfo> = {}): LicenseInfo => ({
  status,
  statusCode: { inactive: 0, needVerify: 1, expired: 2, valid: 3, unknown: 9 }[status],
  activatedAt: "",
  expireAt: "",
  graceUntil: "",
  message: "",
  ...extra,
});

export type FakeLicenseReply = { status?: LicenseStatus; info?: Partial<LicenseInfo>; success?: boolean; message?: string; error?: string };

/** 每次调用按给定的回复改状态（规则和主进程一致：正常就放行） */
export const installFakeLicenseApi = (
  initial: Partial<LicenseState>,
  replies: Partial<Record<"check" | "activate" | "verify", FakeLicenseReply[]>>,
) => {
  let state: LicenseState = { passed: false, skipped: false, devSkipAllowed: false, info: null, ...initial };
  const answer = (kind: "check" | "activate" | "verify") => async (): Promise<LicenseAck> => {
    const reply = replies[kind]?.shift();
    if (!reply) throw new Error(`no reply for ${kind}`);
    if (reply.error) return { success: false, code: "ACK_TIMEOUT", message: reply.error, data: [state] };
    if (reply.status) {
      state = { ...state, info: fakeLicenseInfo(reply.status, reply.info) };
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

export const uninstallFakeLicenseApi = () => {
  delete (window as { csocketApi?: unknown }).csocketApi;
};
