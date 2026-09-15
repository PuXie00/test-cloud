import { TabBar } from "@/app/components/ics/tab-bar";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { EditorDockMode, StaticPresetParams } from "../action-builder-context-types";
import type { SequenceSelection } from "../sequence-selection";
import { ProgramPanel } from "./program-panel";
import { SelectionTabContent } from "./selection-tab-content";

export type ActionRightTab = "selection" | "program";

const RIGHT_TABS = [
  { id: "selection" as const, label: "属性" },
  { id: "program" as const, label: "节目管理" },
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
  onApplyStaticPreset: (presetId: string, objectIds: number[], params: StaticPresetParams) => void;
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
}: ActionRightPanelProps) => (
  <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-lg bg-card">
    <TabBar tabs={RIGHT_TABS} active={activeTab} onChange={onTabChange} variant="underline" />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {activeTab === "selection" && (
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
      )}
      {activeTab === "program" && <ProgramPanel />}
    </div>
  </aside>
);
