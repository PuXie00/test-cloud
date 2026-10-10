import type {
  AiConsoleView,
  AiEntityNames,
  AiNamedRef,
  AiPage,
  AiTreeFocus,
} from "@shared/ai-bridge/types";
import type { ProjectDocument } from "@/app/project/project-document-types";
import type { LeftNavId } from "@/app/pages/console/components/LeftSidebar";
import type { RightPanelTab } from "@/app/pages/console/components/RightSidebar";
import type { ActionRightTab } from "@/app/pages/console/components/action-builder/right-panel/action-right-panel";
import type { ProjectSelection } from "@/app/pages/console/components/right-sidebar/project-data";
import type { ConsoleMode } from "@/app/pages/console/hooks/use-console-mode";
import type { ControlRightTabId } from "@/app/pages/console/hooks/use-control-layout";
import { formatMotorDisplayName } from "@/app/pages/console/hooks/motor-mid";
import { formatPlcDisplayName } from "@/app/pages/console/hooks/plc-display-name";

const RULE_PATH = /^\/console\/rule\/([^/]+)/;

export const resolveAiPage = (pathname: string): { page: AiPage; ruleId: string | null } => {
  if (pathname === "/login") return { page: "login", ruleId: null };
  if (pathname === "/project-center") return { page: "project-center", ruleId: null };
  if (pathname === "/console") return { page: "console", ruleId: null };
  const rule = RULE_PATH.exec(pathname);
  if (rule) return { page: "rule-editor", ruleId: decodeURIComponent(rule[1]) };
  return { page: "other", ruleId: null };
};

/** 电机 / PLC 显示名不入库，按工程列表派生；AI 侧据此给状态补名称 */
export const buildAiEntityNames = (document: ProjectDocument): AiEntityNames => {
  const { plcs, motors, controlledObjects } = document.setup;
  return {
    plcs: Object.fromEntries(plcs.map((plc) => [String(plc.id), formatPlcDisplayName(plcs, plc)])),
    motors: Object.fromEntries(
      motors.map((motor) => [String(motor.id), formatMotorDisplayName(motors, motor)]),
    ),
    objects: Object.fromEntries(controlledObjects.map((object) => [String(object.id), object.name])),
    sequences: Object.fromEntries(
      document.motion.actionSequences.map((sequence) => [String(sequence.id), sequence.name]),
    ),
  };
};

export type AiConsoleViewInput = {
  mode: ConsoleMode;
  nav: LeftNavId;
  devicesTab: RightPanelTab;
  controlTab: ControlRightTabId;
  controlPanelVisible: boolean;
  sequencesTab: ActionRightTab;
  selectedObjectId: number | null;
  multiSelectedObjectIds: readonly number[];
  multiSelectedMotorIds: readonly number[];
  treeFocus: ProjectSelection;
  /** 动作页时间轴编辑器选中的序列 */
  selectedSequenceId: number | null;
  names: AiEntityNames;
};

const named = (table: Record<string, string>, id: number): AiNamedRef => ({
  id,
  name: table[String(id)] ?? String(id),
});

const TREE_FOCUS_NAMES: Record<NonNullable<ProjectSelection>["kind"], keyof AiEntityNames> = {
  "controlled-object": "objects",
  master: "plcs",
  motor: "motors",
};

/** 与界面实际显示一致：演出模式固定在控制页，且没有手动 Tab */
const resolveTab = (input: AiConsoleViewInput, nav: LeftNavId): string | null => {
  if (nav === "devices") return input.devicesTab;
  if (nav === "sequences") return input.sequencesTab;
  if (!input.controlPanelVisible) return null;
  return input.mode === "show" && input.controlTab === "manual" ? "log" : input.controlTab;
};

export const buildAiConsoleView = (input: AiConsoleViewInput): AiConsoleView => {
  const nav = input.mode === "show" ? "control" : input.nav;
  const objectIds = [...input.multiSelectedObjectIds];
  if (input.selectedObjectId !== null && !objectIds.includes(input.selectedObjectId)) {
    objectIds.unshift(input.selectedObjectId);
  }
  const focus = input.treeFocus;
  const treeFocus: AiTreeFocus | null = focus
    ? { ...focus, name: named(input.names[TREE_FOCUS_NAMES[focus.kind]], focus.id).name }
    : null;

  return {
    mode: input.mode,
    nav,
    tab: resolveTab(input, nav),
    selection: {
      objects: objectIds.map((id) => named(input.names.objects, id)),
      primaryObjectId: input.selectedObjectId,
      motors: input.multiSelectedMotorIds.map((id) => named(input.names.motors, id)),
      treeFocus,
      sequence:
        input.selectedSequenceId === null
          ? null
          : named(input.names.sequences, input.selectedSequenceId),
    },
  };
};
