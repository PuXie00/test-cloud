import { PanelHeader } from "@/app/components/ics/panel-header";
import type { ResolvedActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { EditorDockMode } from "../action-builder-context-types";
import type { SequenceSelection } from "../sequence-selection";
import { EmptySelectionState } from "./empty-selection-state";
import {
  objectSelectionModeFromDock,
  preferSequenceProperties,
} from "./object-selection-mode";
import { ObjectSelectionPanel } from "./object-selection-panel";
import { SequencePropertiesPanel } from "./sequence-properties-panel";

type SelectionTabContentProps = {
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

const unresolvedSequenceStub = (sequence: ActionSequenceConfig): ResolvedActionSequence => ({
  id: sequence.id,
  initialPoseByObject: new Map(),
  poses: [],
  posesByObject: new Map(),
  segments: [],
  commands: [],
  totalMs: 0,
});

export const SelectionTabContent = ({
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
}: SelectionTabContentProps) => {
  if (preferSequenceProperties(dockMode, selection) && sequence) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {resolved === null && (
          <p className="shrink-0 bg-warning-surface px-3 py-2 text-body-sm text-warning">
            预设无法解析，可继续编辑块
          </p>
        )}
        <SequencePropertiesPanel
          sequence={sequence}
          resolved={resolved ?? unresolvedSequenceStub(sequence)}
          selection={selection}
          onReplaceBlock={onReplaceBlock}
          onUpdateSegment={onUpdateSegment}
          onDeleteBlock={(blockId) => onDeleteBlock(blockId)}
        />
      </div>
    );
  }

  if (selectedObjectIds.length > 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader title={`物体 · 已选 ${selectedObjectIds.length} 个`} />
        <ObjectSelectionPanel
          mode={objectSelectionModeFromDock(dockMode)}
          selectedObjectIds={selectedObjectIds}
          sequenceMissing={sequenceMissingHint}
          onCreatePose={onCreatePose}
          onCreateSetEnabled={onCreateSetEnabled}
          onCreateSequence={onCreateSequence}
          onApplyStaticPreset={onApplyStaticPreset}
          onApplyDynamicPreset={onApplyDynamicPreset}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="属性" />
      <EmptySelectionState />
    </div>
  );
};
