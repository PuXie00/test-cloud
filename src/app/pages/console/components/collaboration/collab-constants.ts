import type {
  CollaborationState,
  CollabMarker,
  CollabMessage,
  ConflictStrategy,
  FailoverMode,
  HandoverRequest,
  HostRecord,
  HostRole,
  MessageRecipient,
  ObjectGroupAssignment,
  PrimaryBackupState,
  SyncContentState,
} from "./collab-types";

export const COLLAB_TABS = [
  { id: "primary-backup" as const, label: "主备配置" },
  { id: "collaboration" as const, label: "协作管理" },
];

export const DEFAULT_COLLAB_TAB = "primary-backup" as const;

export const HOST_ROLE_LABEL: Record<HostRole, string> = {
  primary: "主控",
  standby: "备控",
  observer: "观察",
};

export const FAILOVER_OPTIONS: { id: FailoverMode; label: string }[] = [
  { id: "auto", label: "自动切换" },
  { id: "manual-confirm", label: "手动确认" },
];

export const CONFLICT_STRATEGY_OPTIONS: { id: ConflictStrategy; label: string }[] = [
  { id: "last-wins", label: "后者优先" },
  { id: "primary-wins", label: "主控优先" },
  { id: "manual-merge", label: "手动合并" },
];

export const MESSAGE_RECIPIENT_OPTIONS: { id: MessageRecipient; label: string }[] = [
  { id: "all", label: "所有主机" },
  { id: "standby", label: "备机" },
  { id: "observer", label: "观察机" },
];

export const OPERATOR_OPTIONS = ["张工", "李操", "王操", "—"];

export const SOURCE_HOST_OPTIONS = ["本机", "备机", "—"];

export const SYNC_CONTENT_LABELS: { key: keyof SyncContentState; label: string }[] = [
  { key: "project", label: "工程数据" },
  { key: "device", label: "设备状态" },
  { key: "execution", label: "执行状态" },
  { key: "log", label: "操作日志" },
];

export const MOCK_HOSTS: HostRecord[] = [
  {
    id: "h1",
    hostname: "YZDITEC-PC-01",
    ip: "192.168.0.100",
    role: "primary",
    configured: true,
  },
  {
    id: "h2",
    hostname: "YZDITEC-PC-02",
    ip: "192.168.0.101",
    role: "standby",
    configured: true,
  },
];

export const DEFAULT_SYNC_CONTENT: SyncContentState = {
  project: true,
  device: true,
  execution: true,
  log: false,
};

export const MOCK_ASSIGNMENTS: ObjectGroupAssignment[] = [
  {
    groupId: "g1",
    groupName: "升降灯架组",
    operator: "张工",
    sourceHost: "本机",
    status: "active",
  },
  {
    groupId: "g2",
    groupName: "移动架组",
    operator: "李操",
    sourceHost: "备机",
    status: "active",
  },
  {
    groupId: "g3",
    groupName: "旋转台组",
    operator: null,
    sourceHost: null,
    status: "idle",
  },
];

export const MOCK_HANDOVER: HandoverRequest[] = [
  { id: "req1", requester: "李操", targetGroup: "移动架组" },
];

export const MOCK_MARKERS: CollabMarker[] = [
  {
    id: "m1",
    location: "升降灯架组 · 轴 3",
    content: "线缆需复查",
    author: "张工",
    time: "14:20",
  },
  {
    id: "m2",
    location: "旋转台组",
    content: "待确认安全范围",
    author: "李操",
    time: "13:45",
  },
];

export const MOCK_MESSAGES: CollabMessage[] = [
  {
    id: "msg1",
    from: "张工",
    to: "所有主机",
    content: "注意 旋转台即将运动",
    time: "14:32",
  },
  {
    id: "msg2",
    from: "李操",
    to: "本机",
    content: "移动架组已就绪",
    time: "14:28",
  },
];

export const cloneHosts = (): HostRecord[] =>
  MOCK_HOSTS.map((host) => ({ ...host }));

export const cloneAssignments = (): ObjectGroupAssignment[] =>
  MOCK_ASSIGNMENTS.map((item) => ({ ...item }));

export const cloneHandover = (): HandoverRequest[] =>
  MOCK_HANDOVER.map((item) => ({ ...item }));

export const cloneMarkers = (): CollabMarker[] =>
  MOCK_MARKERS.map((item) => ({ ...item }));

export const cloneMessages = (): CollabMessage[] =>
  MOCK_MESSAGES.map((item) => ({ ...item }));

export const createDefaultPrimaryBackupState = (): PrimaryBackupState => ({
  hosts: cloneHosts(),
  selectedHostId: "h1",
  failoverMode: "auto",
  switchDelay: 3,
  heartbeatInterval: 500,
  syncContent: { ...DEFAULT_SYNC_CONTENT },
});

export const createDefaultCollaborationState = (): CollaborationState => ({
  hasControl: true,
  assignments: cloneAssignments(),
  conflictStrategy: "last-wins",
  handoverRequests: cloneHandover(),
  markers: cloneMarkers(),
  messages: cloneMessages(),
  editingAssignments: false,
});

export const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

export const formatTimeNow = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};
