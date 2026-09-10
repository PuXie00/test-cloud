export type AlignmentItemId =
  | "origins-set"
  | "objects-aligned"
  | "initial-position"
  | "estop-tested"
  | "limits-confirmed";

export type AlignmentItem = {
  id: AlignmentItemId;
  label: string;
  description: string;
};

export const ALIGNMENT_ITEMS: AlignmentItem[] = [
  {
    id: "origins-set",
    label: "所有绑定电机已设原点",
    description: "每个受控物体的全部驱动单元均已在调试中完成原点标定。",
  },
  {
    id: "objects-aligned",
    label: "受控物体已完成 3D 对齐",
    description: "3D 场景中的模型位置/距离与现场实测一致。",
  },
  {
    id: "initial-position",
    label: "各物体初始位置与现场一致",
    description: "打开工程时设备的实际机械位置与软件显示一致。",
  },
  {
    id: "estop-tested",
    label: "急停回路已测试可用",
    description: "已现场验证急停按钮可立即切断运动。",
  },
  {
    id: "limits-confirmed",
    label: "软 / 硬限位已确认",
    description: "限位参数与现场物理限位匹配，无超程风险。",
  },
];

export type AlignmentConfirmation = {
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

export type AlignmentChecklistState = Record<AlignmentItemId, AlignmentConfirmation>;

export const createEmptyChecklistState = (): AlignmentChecklistState =>
  ALIGNMENT_ITEMS.reduce((acc, item) => {
    acc[item.id] = { confirmed: false, confirmedBy: null, confirmedAt: null };
    return acc;
  }, {} as AlignmentChecklistState);

export const isAllConfirmed = (state: AlignmentChecklistState): boolean =>
  ALIGNMENT_ITEMS.every((item) => state[item.id]?.confirmed);

export const confirmedCount = (state: AlignmentChecklistState): number =>
  ALIGNMENT_ITEMS.reduce((count, item) => count + (state[item.id]?.confirmed ? 1 : 0), 0);

const BUILD_APPLY_INVALIDATED_ITEMS: AlignmentItemId[] = [
  "objects-aligned",
  "initial-position",
  "limits-confirmed",
];

export const invalidateAfterBuildApply = (
  state: AlignmentChecklistState,
): AlignmentChecklistState => {
  const next = { ...state };
  BUILD_APPLY_INVALIDATED_ITEMS.forEach((id) => {
    next[id] = { confirmed: false, confirmedBy: null, confirmedAt: null };
  });
  return next;
};
