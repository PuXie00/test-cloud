export type HostRole = "primary" | "standby" | "observer";

export type HostRecord = {
  id: string;
  hostname: string;
  ip: string;
  role: HostRole;
  configured: boolean;
};

export type ObjectGroupAssignment = {
  groupId: string;
  groupName: string;
  operator: string | null;
  sourceHost: string | null;
  status: "active" | "idle";
};

export type HandoverRequest = {
  id: string;
  requester: string;
  targetGroup: string;
};

export type CollabMarker = {
  id: string;
  location: string;
  content: string;
  author: string;
  time: string;
};

export type CollabMessage = {
  id: string;
  from: string;
  to: string;
  content: string;
  time: string;
};

export type CollabTabId = "primary-backup" | "collaboration";

export type FailoverMode = "auto" | "manual-confirm";

export type ConflictStrategy = "last-wins" | "primary-wins" | "manual-merge";

export type SyncContentKey = "project" | "device" | "execution" | "log";

export type SyncContentState = Record<SyncContentKey, boolean>;

export type MessageRecipient = "all" | "standby" | "observer";

export type PrimaryBackupState = {
  hosts: HostRecord[];
  selectedHostId: string;
  failoverMode: FailoverMode;
  switchDelay: number;
  heartbeatInterval: number;
  syncContent: SyncContentState;
};

export type CollaborationState = {
  hasControl: boolean;
  assignments: ObjectGroupAssignment[];
  conflictStrategy: ConflictStrategy;
  handoverRequests: HandoverRequest[];
  markers: CollabMarker[];
  messages: CollabMessage[];
  editingAssignments: boolean;
};
