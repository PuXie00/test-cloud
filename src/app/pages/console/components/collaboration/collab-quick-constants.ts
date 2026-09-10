import type { CollabQuickSnapshot } from "./collab-quick-types";

export const COLLAB_QUICK_SNAPSHOT: CollabQuickSnapshot = {
  controlOwner: "控台-A",
  operators: [
    {
      id: "op-admin",
      username: "admin",
      label: "admin",
      role: "control",
      online: true,
      reclaimable: false,
      isLocal: true,
    },
    {
      id: "op-tech",
      username: "tech",
      label: "tech",
      role: "partition",
      online: true,
      reclaimable: true,
    },
    {
      id: "op-operator",
      username: "operator",
      label: "operator",
      role: "observe",
      online: false,
      reclaimable: true,
    },
  ],
  hosts: [
    { id: "host-a", name: "控台-A", roleLabel: "主控", online: true, isPrimary: true },
    { id: "host-b", name: "控台-B", roleLabel: "备用", online: true },
    { id: "host-c", name: "控台-C", roleLabel: "区域", online: false },
  ],
};

export const parseConnectedLabel = (connected: string): { count: string; allOnline: boolean } => {
  const match = connected.match(/^(\d+)\/(\d+)/);
  if (!match) return { count: connected, allOnline: true };
  const online = Number(match[1]);
  const total = Number(match[2]);
  return { count: `${online}/${total}`, allOnline: online === total };
};
