import type { ControlledObjectStatus } from "../../monitor-grid/monitor-data";
import { OBJECT_STATUS_LABEL } from "../../monitor-grid/object-status-badge";

/** 手动控制面板里的操作；主操作沿用状态条按钮的 id */
export const MANUAL_OPERATIONS = [
  "couple",
  "enable",
  "reset",
  "home",
  "level",
  "jog",
  "jogSettings",
  "dimension",
  "savePose",
] as const;

export type ManualOperation = (typeof MANUAL_OPERATIONS)[number];

/** 所选物体处于这些状态时禁用的操作；按状态加规则只改这里 */
const BLOCKED_OPERATIONS_BY_STATUS: Partial<
  Record<ControlledObjectStatus, readonly ManualOperation[]>
> = {
  offline: MANUAL_OPERATIONS,
};

export const NO_SELECTION_NOTICE = "请先选择受控物体";

export type ManualControlTarget = {
  name: string;
  status: ControlledObjectStatus;
};

export type ManualControlAvailability = {
  /** 有物体状态不满足时的提示，如「升降灯架-01 离线，无法操作」；未选物体时为 NO_SELECTION_NOTICE */
  notice: string | null;
  allowed: (operation: ManualOperation) => boolean;
};

const formatStatusReason = (status: ControlledObjectStatus, names: readonly string[]): string => {
  const label = OBJECT_STATUS_LABEL[status];
  if (names.length > 1) return `${names.length} 个物体${label}`;
  return `${names[0]} ${label}`;
};

/** 多选时任一物体不满足即整体禁用该操作，避免一组物体只动了一部分 */
export const resolveManualControlAvailability = (
  targets: readonly ManualControlTarget[],
): ManualControlAvailability => {
  if (targets.length === 0) {
    return { notice: NO_SELECTION_NOTICE, allowed: () => false };
  }
  const blocked = new Set<ManualOperation>();
  const namesByStatus = new Map<ControlledObjectStatus, string[]>();
  for (const target of targets) {
    const operations = BLOCKED_OPERATIONS_BY_STATUS[target.status];
    if (!operations || operations.length === 0) continue;
    for (const operation of operations) blocked.add(operation);
    namesByStatus.set(target.status, [...(namesByStatus.get(target.status) ?? []), target.name]);
  }
  if (blocked.size === 0) return { notice: null, allowed: () => true };
  const reasons = [...namesByStatus].map(([status, names]) => formatStatusReason(status, names));
  const effect = blocked.size === MANUAL_OPERATIONS.length ? "无法操作" : "部分操作不可用";
  return {
    notice: `${reasons.join("；")}，${effect}`,
    allowed: (operation) => !blocked.has(operation),
  };
};
