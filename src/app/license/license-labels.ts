import type { LicenseState, LicenseStatus } from "@shared/csocket/license";

export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  inactive: "未激活",
  needVerify: "待联网校验",
  expired: "已过期",
  valid: "正常",
  unknown: "状态异常",
};

export const licenseStatusLabel = (state: LicenseState): string => {
  if (state.skipped && state.info?.status !== "valid") return "开发模式（未授权）";
  return state.info ? LICENSE_STATUS_LABEL[state.info.status] : "未知";
};

/** C++ 给的时间原样显示，空的用破折号 */
export const licenseDate = (value: string | undefined): string => value?.trim() || "—";
