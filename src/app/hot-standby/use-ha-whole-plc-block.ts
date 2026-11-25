import { useHaProjectSync } from "./ha-project-sync-provider";
import { useHaState } from "./ha-state-provider";

/**
 * 整台 PLC 的操作（复位、仿真开关、下载）在热备时能不能做（方案 6.1、6.4、6.5）：
 * 备机上不能做；主机上备机在用设备时也不能做。返回不能做的原因，能做返回 null。
 */
export const useHaWholePlcBlock = (): string | null => {
  const state = useHaState();
  const { snapshot } = useHaProjectSync();
  if (!state?.enabled) return null;
  if (state.role === "standby") return "备机上不能做整台 PLC 的操作，请到主机上操作";
  const holder = snapshot.peerHolders.find((item) => item.deviceIds.length > 0);
  return holder ? `${holder.name} 正在操作设备，暂时不能做整台 PLC 的操作` : null;
};
