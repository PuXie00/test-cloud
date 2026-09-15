import { useMemo } from "react";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { TimelineBlock } from "@/app/project/action-sequence/types";
import { ActionRightPanel } from "./right-panel/action-right-panel";
import { useActionBuilder } from "./use-action-builder";

export const ActionBuilderRightSidebar = () => {
  const {
    activeRightTab,
    setActiveRightTab,
    dockMode,
    sequence,
    selection,
    selectedObjectIds,
    sequenceMissingHint,
    handleReplaceTimelineBlock,
    handleUpdateSegmentSettings,
    handleBlockDelete,
    handleCreatePose,
    handleCreateSetEnabled,
    handleCreateSequence,
    handleApplyStaticPreset,
    handleApplyDynamicPreset,
  } = useActionBuilder();

  const resolved = useMemo(() => {
    if (!sequence) return null;
    try {
      return resolveActionSequence(sequence);
    } catch {
      return null;
    }
  }, [sequence]);

  const handleReplaceBlock = (block: TimelineBlock) => {
    handleReplaceTimelineBlock(block);
  };

  return (
    <ActionRightPanel
      activeTab={activeRightTab}
      onTabChange={setActiveRightTab}
      dockMode={dockMode}
      sequence={sequence}
      resolved={resolved}
      selection={selection}
      selectedObjectIds={selectedObjectIds}
      sequenceMissingHint={sequenceMissingHint}
      onReplaceBlock={handleReplaceBlock}
      onUpdateSegment={handleUpdateSegmentSettings}
      onDeleteBlock={handleBlockDelete}
      onCreatePose={handleCreatePose}
      onCreateSetEnabled={handleCreateSetEnabled}
      onCreateSequence={handleCreateSequence}
      onApplyStaticPreset={handleApplyStaticPreset}
      onApplyDynamicPreset={handleApplyDynamicPreset}
    />
  );
};
