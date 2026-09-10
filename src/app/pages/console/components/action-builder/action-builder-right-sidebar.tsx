import { useCallback, useMemo } from "react";
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
    cues,
    selectedCueId,
    sequenceMissingHint,
    handleReplaceTimelineBlock,
    handleUpdateSegmentSettings,
    handleBlockDelete,
    handleCreatePose,
    handleCreateSetEnabled,
    handleCreateCue,
    handleCreateSequence,
    handleApplyStaticPreset,
    handleApplyDynamicPreset,
    handleCueAddObjects,
  } = useActionBuilder();

  const resolved = useMemo(() => {
    if (!sequence) return null;
    try {
      return resolveActionSequence(sequence);
    } catch {
      return null;
    }
  }, [sequence]);

  const cueObjectIds = useMemo(() => {
    const cue = cues.find((item) => item.id === selectedCueId);
    if (!cue) return [];
    return Object.keys(cue.targets).map(Number);
  }, [cues, selectedCueId]);

  const handleReplaceBlock = (block: TimelineBlock) => {
    handleReplaceTimelineBlock(block);
  };

  const handleAddToCurrentCue = useCallback(
    (objectIds: number[]) => {
      if (!selectedCueId || objectIds.length === 0) return;
      handleCueAddObjects(selectedCueId, objectIds);
    },
    [handleCueAddObjects, selectedCueId],
  );

  return (
    <ActionRightPanel
      activeTab={activeRightTab}
      onTabChange={setActiveRightTab}
      dockMode={dockMode}
      sequence={sequence}
      resolved={resolved}
      selection={selection}
      selectedObjectIds={selectedObjectIds}
      cueObjectIds={cueObjectIds}
      sequenceMissingHint={sequenceMissingHint}
      onReplaceBlock={handleReplaceBlock}
      onUpdateSegment={handleUpdateSegmentSettings}
      onDeleteBlock={handleBlockDelete}
      onCreatePose={handleCreatePose}
      onCreateSetEnabled={handleCreateSetEnabled}
      onCreateCue={handleCreateCue}
      onCreateSequence={handleCreateSequence}
      onApplyStaticPreset={handleApplyStaticPreset}
      onApplyDynamicPreset={handleApplyDynamicPreset}
      onAddToCurrentCue={handleAddToCurrentCue}
    />
  );
};
