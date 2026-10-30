export type ProjectSelection =
  | { kind: "controlled-object"; id: number }
  | { kind: "master"; id: number }
  | { kind: "motor"; id: number }
  | null;

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

export type {
  ControlledObject,
  Motor,
  Plc,
  WizardStepKey,
} from "./config-wizard/config-wizard-types";
