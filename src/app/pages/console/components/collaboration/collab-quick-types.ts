export type QuickOperatorRole = "control" | "partition" | "observe";

export type QuickOperator = {
  id: string;
  username: string;
  label: string;
  role: QuickOperatorRole;
  online: boolean;
  reclaimable: boolean;
  isLocal?: boolean;
};

export type QuickHostItem = {
  id: string;
  name: string;
  roleLabel: string;
  online: boolean;
  isPrimary?: boolean;
};

export type CollabQuickSnapshot = {
  controlOwner: string;
  operators: QuickOperator[];
  hosts: QuickHostItem[];
};

export const QUICK_OPERATOR_ROLE_LABEL: Record<QuickOperatorRole, string> = {
  control: "控制权",
  partition: "分区控制",
  observe: "观察",
};
