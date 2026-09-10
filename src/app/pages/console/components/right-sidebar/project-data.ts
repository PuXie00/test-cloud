export type ProjectSelection =
  | { kind: "controlled-object"; id: number }
  | { kind: "master"; id: number }
  | { kind: "motor"; id: number }
  | null;

export type AlignmentMethod = "distance" | "calibrate";

export type AlignmentStatus = "not_started" | "in_progress" | "aligned";

export type AlignmentRecord = {
  method: AlignmentMethod | null;
  status: AlignmentStatus;
  alignedAt: string | null;
};

export type ScanResultItem = {
  id: string;
  nodeAddress: string;
  deviceType: string;
  alreadyAdded: boolean;
};

export const SCAN_MOCK_RESULTS: ScanResultItem[] = [
  { id: "scan-1", nodeAddress: "4.1", deviceType: "伺服驱动器", alreadyAdded: false },
  { id: "scan-2", nodeAddress: "4.2", deviceType: "伺服驱动器", alreadyAdded: false },
  { id: "scan-3", nodeAddress: "5.1", deviceType: "I/O 模块", alreadyAdded: true },
];

export const ALIGNMENT_BY_OBJECT: Record<number, AlignmentRecord> = {
  9: { method: "distance", status: "aligned", alignedAt: "2026-05-26T09:12:00Z" },
  10: { method: null, status: "not_started", alignedAt: null },
};

export type {
  ControlledObject,
  Motor,
  Plc,
  WizardStepKey,
  WizardStepState,
} from "./config-wizard/config-wizard-types";
