import type { HaPeerSyncState } from "@shared/ha/protocol";
import type { HaLinkState, HaPeerView, HaProjectInfo, HaRole, HaState } from "@shared/ha/types";
import type { HaStandbyPhase } from "@/app/hot-standby/ha-project-sync";

export type HaTone = "ok" | "warn" | "idle";

export const HA_LINK_LABELS: Record<HaLinkState, string> = {
  up: "已连接",
  connecting: "连接中",
  down: "已断开",
};

export const HA_ROLE_LABELS: Record<HaRole, string> = {
  primary: "主机",
  standby: "备机",
};

/** 核对状态（方案 4.3）：主机看每台备机，备机看自己 */
export const HA_SYNC_STATE_LABELS: Record<HaPeerSyncState | HaStandbyPhase, string> = {
  idle: "未同步",
  checking: "核对中",
  confirm: "待确认用哪边的",
  pulling: "正在取主机的内容",
  pushing: "正在把本机的内容发给主机",
  synced: "已同步",
};

/** 对方这一行的说明：版本、是否关闭了热备、打开的是不是同一个工程 */
export const describePeer = (
  peer: HaPeerView,
  localProject: HaProjectInfo | null,
): { text: string; tone: HaTone } => {
  if (peer.closedByPeer) return { text: "对方已关闭热备", tone: "warn" };
  if (peer.link !== "up") return { text: HA_LINK_LABELS[peer.link], tone: peer.link === "down" ? "warn" : "idle" };
  if (peer.versionMismatch) return { text: "两边软件的热备版本不一致，不同步", tone: "warn" };
  if (!peer.hostName) return { text: "等待对方回应", tone: "idle" };
  if (!peer.project) return { text: "对方没有打开工程", tone: "warn" };
  if (!localProject) return { text: `对方打开的是「${peer.project.name}」，本机没有打开工程`, tone: "warn" };
  if (peer.project.id !== localProject.id) {
    return { text: `对方打开的是「${peer.project.name}」，不是同一个工程`, tone: "warn" };
  }
  if (peer.project.formatVersion !== localProject.formatVersion) {
    return { text: "同一个工程，但工程格式版本不一致，不同步", tone: "warn" };
  }
  return { text: `同一个工程「${peer.project.name}」`, tone: "ok" };
};

/** 顶栏上的热备状态 */
export const summarizeHa = (state: HaState): { label: string; tone: HaTone } => {
  if (!state.enabled) return { label: "热备未开启", tone: "idle" };
  if (state.role === "primary") {
    const connected = state.peers.filter((peer) => peer.link === "up").length;
    return connected > 0
      ? { label: `主机 · ${connected} 台备机`, tone: "ok" }
      : { label: "主机 · 等待备机", tone: "warn" };
  }
  const primary = state.peers[0];
  if (!primary || primary.link !== "up") {
    return { label: primary?.closedByPeer ? "备机 · 主机已关闭热备" : "备机 · 与主机断开", tone: "warn" };
  }
  return state.deviceGate ? { label: "备机 · 未同步", tone: "warn" } : { label: "备机 · 已同步", tone: "ok" };
};
