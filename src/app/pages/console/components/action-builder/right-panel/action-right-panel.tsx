import { usePermissions } from "@/app/auth/permissions";
import { ReadOnlyScope } from "@/app/components/ics/read-only-scope";
import { TabBar } from "@/app/components/ics/tab-bar";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { EditorDockMode } from "../action-builder-context-types";
import type { SequenceSelection } from "../sequence-selection";
import { ProgramPanel } from "../../program-panel/program-panel";
import { ActionManualControlTab } from "./action-manual-control-tab";
import { SelectionTabContent } from "./selection-tab-content";

/** "manual" 与视口「当前位置」同步：选中该 tab 即显示设备实时位置 */
export type ActionRightTab = "selection" | "manual" | "program";

const RIGHT_TABS: { id: ActionRightTab; label: string }[] = [
  { id: "selection", label: "属性" },
  { id: "manual", label: "手动控制" },
  { id: "program", label: "节目管理" },
];

type ActionRightPanelProps = {
  activeTab: ActionRightTab;
  onTabChange: (tab: ActionRightTab) => void;
  dockMode: EditorDockMode;
  sequence: ActionSequenceConfig | null;
  resolved: ResolvedActionSequence | null;
  selection: SequenceSelection;
  selectedObjectIds: number[];
  sequenceMissingHint: boolean;
  onReplaceBlock: (block: TimelineBlock) => void;
  onUpdateSegment: (
    fromRef: string,
    toRef: string,
    settings: MotionSegmentSettings,
  ) => void;
  onDeleteBlock: (blockIds?: string | string[]) => void;
  onCreatePose: (objectIds: number[]) => void;
  onCreateSetEnabled: (objectIds: number[], enabled: boolean) => void;
  onCreateSequence: (objectIds: number[]) => void;
  onApplyStaticPreset: (presetId: string, objectIds: number[]) => void;
  onApplyDynamicPreset: (presetId: string, objectIds: number[]) => void;
};

export const ActionRightPanel = ({
  activeTab,
  onTabChange,
  dockMode,
  sequence,
  resolved,
  selection,
  selectedObjectIds,
  sequenceMissingHint,
  onReplaceBlock,
  onUpdateSegment,
  onDeleteBlock,
  onCreatePose,
  onCreateSetEnabled,
  onCreateSequence,
  onApplyStaticPreset,
  onApplyDynamicPreset,
}: ActionRightPanelProps) => {
  const { can, canAny } = usePermissions();
  // 没有「编辑动作序列」属性只读；手动控制要手动运动 / 设备状态 / 耦合之一
  const readOnly = !can("action.edit");
  const canManual = canAny("control.manual", "control.device", "control.couple");
  const tabs = canManual ? RIGHT_TABS : RIGHT_TABS.filter((tab) => tab.id !== "manual");
  const shownTab: ActionRightTab = activeTab === "manual" && !canManual ? "selection" : activeTab;

  return (
  <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-lg bg-card">
    <TabBar tabs={tabs} active={shownTab} onChange={onTabChange} variant="underline" />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {shownTab === "selection" && readOnly && (
        <p className="shrink-0 bg-muted/60 px-3 py-1.5 text-body-sm text-muted-foreground">
          只读：没有「编辑动作序列」权限
        </p>
      )}
      {shownTab === "selection" && (
        <ReadOnlyScope readOnly={readOnly} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SelectionTabContent
          dockMode={dockMode}
          sequence={sequence}
          resolved={resolved}
          selection={selection}
          selectedObjectIds={selectedObjectIds}
          sequenceMissingHint={sequenceMissingHint}
          onReplaceBlock={onReplaceBlock}
          onUpdateSegment={onUpdateSegment}
          onDeleteBlock={onDeleteBlock}
          onCreatePose={onCreatePose}
          onCreateSetEnabled={onCreateSetEnabled}
          onCreateSequence={onCreateSequence}
          onApplyStaticPreset={onApplyStaticPreset}
          onApplyDynamicPreset={onApplyDynamicPreset}
        />
        </ReadOnlyScope>
      )}
      {shownTab === "manual" && <ActionManualControlTab />}
      {shownTab === "program" && <ProgramPanel variant="authoring" />}
    </div>
  </aside>
  );
};
