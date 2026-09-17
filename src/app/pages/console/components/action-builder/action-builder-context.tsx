import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { TrajectoryMode } from "@shared/action-sequence";
import {
  hydrateMotionForActionBuilder,
  setupObjectToTimelineObject,
} from "@/app/project/motion-adapters";
import { actionBuilderStateToMotion } from "@/app/project/motion-persist";
import { useProject } from "@/app/project/use-project";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import type { SequenceIssue } from "@/app/project/action-sequence/validate-sequence";
import { sequenceValidationContextFromSetup } from "@/app/project/project-motion-readiness";
import { allocateSequenceIdsInProject } from "@/app/project/action-sequence/sequence-id";
import type { ActionSequenceConfig, ModelPose, MotionSegmentSettings, TimelineBlock } from "@/app/project/action-sequence/types";
import {
  actionSequencePathIsClosed,
  reconcileSequenceLoop,
  SEQUENCE_LOOP_CLEARED_TOAST,
} from "@/app/project/action-sequence/sequence-loop";
import type { ProjectMotion, VirtualAxisId } from "@/app/project/project-document-types";
import {
  createEmptySequence,
  defaultPresetParams,
  DEFAULT_BLOCK_MS,
  nextId,
} from "./action-builder-ops";
import {
  applyPoseAxisWrite,
  copyTimelineBlocks,
  deleteTimelineBlocks,
  insertTimelineBlock,
  type PoseAxisWrite,
  type SequenceEditOptions,
  moveTimelineBlock,
  pasteTimelineBlocks,
  replaceTimelineBlock,
  resizeDynamicPreset,
  shiftTimelineBlocks,
  updateSegmentSettings,
  type EditResult,
} from "./sequence-ops";
import {
  pruneSequenceSelection,
  selectionBlockIds,
  selectionFromBlockIds,
  type SequenceSelection,
} from "./sequence-selection";
import { clampCursorMs } from "./timeline/timeline-view-extent";
import {
  clampTimelinePxPerSecond,
  TIMELINE_PX_PER_SECOND_DEFAULT,
  TIMELINE_ZOOM_FACTOR,
  type ControlledObject as TimelineControlledObject,
  type ProgramNode,
} from "./timeline/timeline-data";
import type {
  ActionBuilderContextValue,
  EditorDockMode,
  ProgramItemInput,
  StaticPresetParams,
} from "./action-builder-context-types";
import { ActionBuilderContext } from "./action-builder-react-context";
import type { ContextSelection } from "./context-bar/selection-context-bar";
import type { ActionRightTab } from "./right-panel/action-right-panel";

export { useActionBuilder } from "./use-action-builder";

type MotionProjection = {
  sequences: ActionSequenceConfig[];
  programs: ProgramNode[];
};

export const ActionBuilderProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject, updateCurrentDocument, documentRevision } = useProject();

  const [sequences, setSequences] = useState<ActionSequenceConfig[]>([]);
  const [selectedSequenceId, setSelectedSequenceId] = useState<number | null>(null);
  const [selection, setSelection] = useState<SequenceSelection>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<number[]>([]);
  const [cursorMs, setCursorMs] = useState(0);
  const [activeRightTab, setActiveRightTab] = useState<ActionRightTab>("selection");
  const [selectedProgramNodeId, setSelectedProgramNodeId] = useState<string | null>(null);
  const [programs, setPrograms] = useState<ProgramNode[]>([]);
  const [timelineObjects, setTimelineObjects] = useState<TimelineControlledObject[]>([]);
  const [sequenceMissingHint, setSequenceMissingHint] = useState(false);
  const [timelinePxPerSecond, setTimelinePxPerSecond] = useState(TIMELINE_PX_PER_SECOND_DEFAULT);
  const [clipboardBlocks, setClipboardBlocks] = useState<TimelineBlock[]>([]);
  const [lastPersistError, setLastPersistError] = useState<string | null>(null);
  const [isShiftingBlocks, setIsShiftingBlocks] = useState(false);
  const [sequenceIssues, setSequenceIssues] = useState<SequenceIssue[]>([]);
  const shiftOriginRef = useRef<ActionSequenceConfig | null>(null);
  const selectedBlockIds = selectionBlockIds(selection);
  const selectedBlockId = selectedBlockIds[0] ?? null;

  const motionRef = useRef<MotionProjection>({ sequences, programs });
  const hydratingRef = useRef(false);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const hydratedMotionRef = useRef<ProjectMotion | null>(null);

  const commitMotionProjection = useCallback(
    (next: MotionProjection): boolean => {
      if (hydratingRef.current) return false;
      const result = updateCurrentDocument(
        (doc) => ({
          ...doc,
          motion: actionBuilderStateToMotion(
            { sequences: next.sequences, programs: next.programs },
            doc.motion,
          ),
        }),
        "motion",
      );
      if (!result.ok) {
        setLastPersistError(result.reason);
        return false;
      }
      setLastPersistError(null);
      motionRef.current = next;
      setSequences(next.sequences);
      setPrograms(next.programs);
      return true;
    },
    [updateCurrentDocument],
  );

  useEffect(() => {
    if (!currentProject?.document) {
      if (hydratedProjectIdRef.current !== null) {
        hydratedProjectIdRef.current = null;
        hydratedMotionRef.current = null;
        hydratingRef.current = true;
        motionRef.current = { sequences: [], programs: [] };
        setSequences([]);
        setPrograms([]);
        setTimelineObjects([]);
        setSelectedSequenceId(null);
        setSelection(null);
        setCursorMs(0);
        hydratingRef.current = false;
      }
      return;
    }

    const document = currentProject.document;
    const projectChanged = hydratedProjectIdRef.current !== currentProject.id;
    if (!projectChanged) {
      if (documentRevision.origin === "motion") {
        hydratedMotionRef.current = document.motion;
        return;
      }
      if (
        documentRevision.origin === "setup" &&
        hydratedMotionRef.current === document.motion
      ) {
        hydratingRef.current = true;
        const nextTimelineObjects = document.setup.controlledObjects.map((object) =>
          setupObjectToTimelineObject(object, document.setup.motors),
        );
        const objectIds = new Set(nextTimelineObjects.map((object) => object.id));
        setTimelineObjects(nextTimelineObjects);
        setSelectedObjectIds((prev) => {
          const next = prev.filter((id) => objectIds.has(id));
          return next.length === prev.length ? prev : next;
        });
        hydratedMotionRef.current = document.motion;
        hydratingRef.current = false;
        return;
      }
    }

    const names = Object.fromEntries(
      document.setup.controlledObjects.map((object) => [object.id, object.name]),
    );
    const bundle = hydrateMotionForActionBuilder(
      document.motion,
      names,
      document.setup.controlledObjects,
      document.setup.motors,
    );

    hydratingRef.current = true;
    motionRef.current = {
      sequences: bundle.sequences,
      programs: bundle.programs,
    };
    setSequences(bundle.sequences);
    setPrograms(bundle.programs);
    setTimelineObjects(bundle.timelineObjects);
    setSelectedSequenceId((prev) =>
      bundle.sequences.some((item) => item.id === prev)
        ? prev
        : (bundle.sequences[0]?.id ?? null),
    );
    setSelectedObjectIds((prev) => {
      if (prev.length === 0) return prev;
      const objectIds = new Set(bundle.timelineObjects.map((object) => object.id));
      const next = prev.filter((id) => objectIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    setSelection((prev) => pruneSequenceSelection(bundle.sequences, prev));
    if (projectChanged) setCursorMs(0);
    hydratedProjectIdRef.current = currentProject.id;
    hydratedMotionRef.current = document.motion;
    hydratingRef.current = false;
  }, [currentProject?.id, currentProject?.document, documentRevision]);

  const getTimelineObject = useCallback(
    (objectId: number): TimelineControlledObject | undefined =>
      timelineObjects.find((object) => object.id === objectId),
    [timelineObjects],
  );

  const sequence = useMemo(
    () => sequences.find((item) => item.id === selectedSequenceId) ?? null,
    [sequences, selectedSequenceId],
  );

  useEffect(() => {
    if (isShiftingBlocks) return;
    const document = currentProject?.document;
    if (!sequence || !document) {
      setSequenceIssues([]);
      return;
    }
    try {
      setSequenceIssues(validateActionSequence(sequence, sequenceValidationContextFromSetup(document)));
    } catch {
      setSequenceIssues([]);
    }
  }, [sequence, currentProject?.document, isShiftingBlocks]);

  const dockMode = useMemo((): EditorDockMode => {
    if (sequence) return "sequence";
    return "empty";
  }, [sequence]);

  const contextSelection = useMemo((): ContextSelection | null => {
    if (selectedBlockId) return { kind: "block", blockId: selectedBlockId };
    if (selectedObjectIds.length === 1) return { kind: "object", objectId: selectedObjectIds[0] };
    if (selectedSequenceId !== null) return { kind: "sequence", sequenceId: selectedSequenceId };
    return null;
  }, [selectedBlockId, selectedObjectIds, selectedSequenceId]);

  const commitSequences = useCallback(
    (nextSequences: ActionSequenceConfig[]): boolean =>
      commitMotionProjection({ ...motionRef.current, sequences: nextSequences }),
    [commitMotionProjection],
  );

  const updateSelectedSequence = useCallback(
    (updater: (current: ActionSequenceConfig) => ActionSequenceConfig | null): boolean => {
      if (selectedSequenceId === null) return false;
      const current = motionRef.current.sequences.find((item) => item.id === selectedSequenceId);
      if (!current) return false;
      const next = updater(current);
      if (next === null || next === current) return false;
      const reconciled = reconcileSequenceLoop(next);
      if (reconciled.cleared) toast.warning(SEQUENCE_LOOP_CLEARED_TOAST);
      return commitSequences(
        motionRef.current.sequences.map((item) =>
          item.id === selectedSequenceId ? reconciled.sequence : item,
        ),
      );
    },
    [selectedSequenceId, commitSequences],
  );

  const applySequenceEdit = useCallback(
    (edit: (current: ActionSequenceConfig) => EditResult): boolean =>
      updateSelectedSequence((current) => {
        const result = edit(current);
        return result.ok ? result.sequence : null;
      }),
    [updateSelectedSequence],
  );

  const updatePrograms = useCallback(
    (updater: (current: ProgramNode[]) => ProgramNode[]): boolean => {
      const nextPrograms = updater(motionRef.current.programs);
      return commitMotionProjection({ ...motionRef.current, programs: nextPrograms });
    },
    [commitMotionProjection],
  );

  const handleSequenceSelect = useCallback((sequenceId: number | null) => {
    setSelectedSequenceId(sequenceId);
    setSelection(null);
    setSequenceMissingHint(false);
    setCursorMs(0);
  }, []);

  const handleSelectionChange = useCallback((next: SequenceSelection) => {
    setSelection(next);
    setActiveRightTab("selection");
    setSequenceMissingHint(false);
  }, []);

  const handleObjectSelect = useCallback((objectId: number) => {
    setSelectedObjectIds([objectId]);
    setSelection(null);
    setActiveRightTab("selection");
    setSequenceMissingHint(false);
  }, []);

  const handleObjectsSelect = useCallback((objectIds: number[]) => {
    setSelectedObjectIds((prev) => {
      if (prev.length === objectIds.length && prev.every((id, index) => id === objectIds[index])) {
        return prev;
      }
      return objectIds;
    });
    setSelection(null);
    setActiveRightTab("selection");
    setSequenceMissingHint(false);
  }, []);

  const handleCursorChange = useCallback((ms: number) => {
    setCursorMs(clampCursorMs(ms));
  }, []);

  const sequenceEditOptions = useMemo<SequenceEditOptions>(
    () => ({
      minAccelTimeByObject: (objectId) => getTimelineObject(objectId)?.minAccelTimeByAxis,
    }),
    [getTimelineObject],
  );

  const handleInsertTimelineBlock = useCallback(
    (block: TimelineBlock): boolean =>
      applySequenceEdit((current) => insertTimelineBlock(current, block, sequenceEditOptions)),
    [applySequenceEdit, sequenceEditOptions],
  );

  const handleReplaceTimelineBlock = useCallback(
    (block: TimelineBlock): boolean =>
      applySequenceEdit((current) => replaceTimelineBlock(current, block, sequenceEditOptions)),
    [applySequenceEdit, sequenceEditOptions],
  );

  const handleApplyPoseAxisWrite = useCallback(
    (blockIds: readonly string[], write: PoseAxisWrite): boolean =>
      applySequenceEdit((current) =>
        applyPoseAxisWrite(current, blockIds, write, {
          ...sequenceEditOptions,
          objectInfo: (objectId) => {
            const object = getTimelineObject(objectId);
            if (object === undefined) return undefined;
            return {
              enabledAxes: object.enabledAxes,
              rangeByAxis: object.rangeByAxis,
            };
          },
        }),
      ),
    [applySequenceEdit, getTimelineObject, sequenceEditOptions],
  );

  const handleMoveTimelineBlock = useCallback(
    (blockId: string, atMs: number) => {
      updateSelectedSequence((current) =>
        moveTimelineBlock(current, blockId, atMs, sequenceEditOptions),
      );
    },
    [updateSelectedSequence, sequenceEditOptions],
  );

  const handleShiftTimelineBlocks = useCallback(
    (blockIds: string[], deltaMs: number) => {
      setIsShiftingBlocks(true);
      updateSelectedSequence((current) => {
        const origin = shiftOriginRef.current ?? current;
        if (shiftOriginRef.current === null) shiftOriginRef.current = current;
        return shiftTimelineBlocks(origin, blockIds, deltaMs, sequenceEditOptions);
      });
    },
    [updateSelectedSequence, sequenceEditOptions],
  );

  const handleShiftTimelineBlocksEnd = useCallback(() => {
    shiftOriginRef.current = null;
    setIsShiftingBlocks(false);
  }, []);

  const handleResizeDynamicPreset = useCallback(
    (blockId: string, startMs: number, endMs: number): boolean =>
      applySequenceEdit((current) =>
        resizeDynamicPreset(current, blockId, startMs, endMs, sequenceEditOptions),
      ),
    [applySequenceEdit, sequenceEditOptions],
  );

  const handleUpdateSegmentSettings = useCallback(
    (fromRef: string, toRef: string, settings: MotionSegmentSettings) => {
      updateSelectedSequence((current) => updateSegmentSettings(current, fromRef, toRef, settings));
    },
    [updateSelectedSequence],
  );

  const handleTrajectoryModeChange = useCallback(
    (trajectoryMode: TrajectoryMode) => {
      updateSelectedSequence((current) => ({ ...current, trajectoryMode }));
    },
    [updateSelectedSequence],
  );

  const handleLoopChange = useCallback(
    (loop: boolean) => {
      updateSelectedSequence((current) => {
        if (loop && !actionSequencePathIsClosed(current)) return current;
        if (!loop && current.loop !== true) return current;
        return { ...current, loop };
      });
    },
    [updateSelectedSequence],
  );

  const handleBlockDelete = useCallback(
    (blockIds?: string | string[]) => {
      const ids = typeof blockIds === "string" ? [blockIds] : (blockIds ?? selectedBlockIds);
      if (ids.length === 0) return;
      const deletedIds = new Set(ids);
      if (!updateSelectedSequence((current) => deleteTimelineBlocks(current, ids, sequenceEditOptions)))
        return;
      setSelection((current) => {
        const remaining = selectionBlockIds(current).filter((id) => !deletedIds.has(id));
        if (remaining.length === 0) return null;
        if (remaining.length === 1) {
          const blockId = remaining[0];
          return blockId === undefined ? null : { kind: "block", blockId };
        }
        return { kind: "multi-block", blockIds: remaining };
      });
    },
    [selectedBlockIds, updateSelectedSequence, sequenceEditOptions],
  );

  const poseForObject = useCallback(
    (objectId: number): ModelPose => {
      const object = getTimelineObject(objectId);
      return { v1: object?.currentPosition ?? 0, v2: 0, v3: 0 };
    },
    [getTimelineObject],
  );

  const handleCreatePose = useCallback(
    (objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const createdIds: string[] = [];
      const ok = updateSelectedSequence((current) => {
        let next = current;
        for (const objectId of objectIds) {
          const block: TimelineBlock = {
            id: nextId("blk"),
            kind: "pose",
            objectId,
            atMs: cursorMs,
            pose: poseForObject(objectId),
          };
          const result = insertTimelineBlock(next, block, sequenceEditOptions);
          if (!result.ok) continue;
          next = result.sequence;
          createdIds.push(block.id);
        }
        return next === current ? null : next;
      });
      if (!ok) return;
      setSelection(selectionFromBlockIds(createdIds));
      setSequenceMissingHint(false);
    },
    [selectedSequenceId, sequence, cursorMs, poseForObject, updateSelectedSequence, sequenceEditOptions],
  );

  const handleCreateSetEnabled = useCallback(
    (objectIds: number[], enabled: boolean) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const createdIds: string[] = [];
      const ok = updateSelectedSequence((current) => {
        let next = current;
        for (const objectId of objectIds) {
          const block: TimelineBlock = {
            id: nextId("blk"),
            kind: "instruction",
            presetId: "set-enabled",
            objectId,
            atMs: cursorMs,
            instr: { enabled },
          };
          const result = insertTimelineBlock(next, block);
          if (!result.ok) continue;
          next = result.sequence;
          createdIds.push(block.id);
        }
        return next === current ? null : next;
      });
      if (!ok) return;
      setSelection(selectionFromBlockIds(createdIds));
      setSequenceMissingHint(false);
    },
    [selectedSequenceId, sequence, cursorMs, updateSelectedSequence],
  );

  const handleCreateSequence = useCallback(
    (_objectIds: number[]) => {
      let id: number;
      try {
        [id] = allocateSequenceIdsInProject(motionRef.current.sequences, 1);
      } catch (error) {
        setLastPersistError(error instanceof Error ? error.message : "动作序列 id 已满（1~65535）");
        return;
      }
      const next = createEmptySequence(id);
      const nextSequences = [...motionRef.current.sequences, next];
      if (!commitMotionProjection({ ...motionRef.current, sequences: nextSequences })) return;
      handleSequenceSelect(next.id);
    },
    [commitMotionProjection, handleSequenceSelect],
  );

  const handleApplyStaticPreset = useCallback(
    (presetId: string, objectIds: number[], params: StaticPresetParams) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const registryParams = defaultPresetParams(presetId, params);
      if (!registryParams || objectIds.length < 2) return;
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "static-preset",
        presetId,
        atMs: cursorMs,
        orderedObjectIds: [...objectIds],
        params: registryParams,
      };
      if (!handleInsertTimelineBlock(block)) return;
      setSelection({ kind: "block", blockId: block.id });
      setSequenceMissingHint(false);
    },
    [selectedSequenceId, sequence, cursorMs, handleInsertTimelineBlock],
  );

  const handleApplyDynamicPreset = useCallback(
    (presetId: string, objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const registryParams = defaultPresetParams(presetId);
      if (!registryParams || objectIds.length < 2) return;
      const mergedMinAccel: Partial<Record<VirtualAxisId, number>> = {};
      for (const objectId of objectIds) {
        const byAxis = getTimelineObject(objectId)?.minAccelTimeByAxis;
        if (!byAxis) continue;
        for (const axis of ["v1", "v2", "v3"] as const) {
          const value = byAxis[axis];
          if (value === undefined) continue;
          mergedMinAccel[axis] = Math.max(mergedMinAccel[axis] ?? 0, value);
        }
      }
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "dynamic-preset",
        presetId,
        startMs: cursorMs,
        endMs: cursorMs + DEFAULT_BLOCK_MS,
        orderedObjectIds: [...objectIds],
        params: registryParams,
        profiles: createDefaultAxisProfiles(
          DEFAULT_BLOCK_MS,
          Object.keys(mergedMinAccel).length > 0 ? mergedMinAccel : undefined,
        ),
      };
      if (!handleInsertTimelineBlock(block)) return;
      setSelection({ kind: "block", blockId: block.id });
      setSequenceMissingHint(false);
    },
    [selectedSequenceId, sequence, cursorMs, handleInsertTimelineBlock, getTimelineObject],
  );

  const handleBlockCopy = useCallback(() => {
    if (selectedBlockIds.length === 0 || !sequence) return;
    setClipboardBlocks(copyTimelineBlocks(sequence, selectedBlockIds));
  }, [selectedBlockIds, sequence]);

  const handleBlockPaste = useCallback(() => {
    if (clipboardBlocks.length === 0 || !selectedSequenceId) return;
    let createdIds: string[] = [];
    const ok = updateSelectedSequence((current) => {
      const pasted = pasteTimelineBlocks(current, clipboardBlocks, cursorMs, sequenceEditOptions);
      if (!pasted.ok) return null;
      createdIds = pasted.createdIds;
      return pasted.sequence;
    });
    if (!ok || createdIds.length === 0) return;
    setSelection(
      createdIds.length === 1
        ? { kind: "block", blockId: createdIds[0]! }
        : { kind: "multi-block", blockIds: createdIds },
    );
  }, [clipboardBlocks, selectedSequenceId, cursorMs, updateSelectedSequence, sequenceEditOptions]);

  const handleTimelinePxPerSecondChange = useCallback((pxPerSecond: number) => {
    setTimelinePxPerSecond(clampTimelinePxPerSecond(pxPerSecond));
  }, []);

  const handleTimelineZoomIn = useCallback(() => {
    setTimelinePxPerSecond((current) =>
      clampTimelinePxPerSecond(current / TIMELINE_ZOOM_FACTOR),
    );
  }, []);

  const handleTimelineZoomOut = useCallback(() => {
    setTimelinePxPerSecond((current) =>
      clampTimelinePxPerSecond(current * TIMELINE_ZOOM_FACTOR),
    );
  }, []);

  const handleChapterAdd = useCallback(() => {
    updatePrograms((current) => {
      const chapter: ProgramNode = {
        id: nextId("ch"),
        name: `第 ${(current[0]?.children?.length ?? 0) + 1} 章`,
        type: "chapter",
        children: [],
      };
      if (current.length === 0) {
        return [{ id: nextId("prog"), name: "新节目", type: "program", children: [chapter] }];
      }
      return current.map((program, index) =>
        index === 0
          ? { ...program, children: [...(program.children ?? []), chapter] }
          : program,
      );
    });
  }, [updatePrograms]);

  const handleProgramItemInsert = useCallback(
    (chapterId: string, item: ProgramItemInput, index?: number) => {
      if (item.kind !== "sequence") return;
      const entity = motionRef.current.sequences.find((seq) => seq.id === item.refId);
      if (!entity) return;
      const node: ProgramNode = { id: String(item.refId), name: entity.name, type: "sequence" };
      updatePrograms((current) =>
        current.map((program) => ({
          ...program,
          children: (program.children ?? []).map((chapter) => {
            if (chapter.id !== chapterId) return chapter;
            const children = [...(chapter.children ?? [])];
            const at = index === undefined ? children.length : Math.min(index, children.length);
            children.splice(at, 0, node);
            return { ...chapter, children };
          }),
        })),
      );
    },
    [updatePrograms],
  );

  const handleProgramItemRemove = useCallback(
    (chapterId: string, index: number) => {
      updatePrograms((current) =>
        current.map((program) => ({
          ...program,
          children: (program.children ?? []).map((chapter) => {
            if (chapter.id !== chapterId) return chapter;
            const children = [...(chapter.children ?? [])];
            children.splice(index, 1);
            return { ...chapter, children };
          }),
        })),
      );
    },
    [updatePrograms],
  );

  const handleProgramItemMove = useCallback(
    (chapterId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      updatePrograms((current) =>
        current.map((program) => ({
          ...program,
          children: (program.children ?? []).map((chapter) => {
            if (chapter.id !== chapterId) return chapter;
            const children = [...(chapter.children ?? [])];
            const [moved] = children.splice(fromIndex, 1);
            if (!moved) return chapter;
            const at = fromIndex < toIndex ? toIndex - 1 : toIndex;
            children.splice(Math.max(0, Math.min(at, children.length)), 0, moved);
            return { ...chapter, children };
          }),
        })),
      );
    },
    [updatePrograms],
  );

  const handleSave = useCallback(() => {
    // Safety validation placeholder
  }, []);

  const value = useMemo(
    (): ActionBuilderContextValue => ({
      sequences,
      sequence,
      selectedSequenceId,
      selection,
      selectedBlockId,
      selectedObjectIds,
      cursorMs,
      activeRightTab,
      selectedProgramNodeId,
      contextSelection,
      programs,
      timelineObjects,
      getTimelineObject,
      sequenceMissingHint,
      dockMode,
      timelinePxPerSecond,
      canPasteBlock: clipboardBlocks.length > 0,
      setActiveRightTab,
      handleSequenceSelect,
      handleSelectionChange,
      handleObjectSelect,
      handleObjectsSelect,
      handleCursorChange,
      handleInsertTimelineBlock,
      handleReplaceTimelineBlock,
      handleApplyPoseAxisWrite,
      handleMoveTimelineBlock,
      handleShiftTimelineBlocks,
      handleShiftTimelineBlocksEnd,
      handleResizeDynamicPreset,
      handleUpdateSegmentSettings,
      handleBlockDelete,
      handleTrajectoryModeChange,
      handleLoopChange,
      handleBlockCopy,
      handleBlockPaste,
      handleTimelinePxPerSecondChange,
      handleTimelineZoomIn,
      handleTimelineZoomOut,
      handleCreatePose,
      handleCreateSetEnabled,
      handleCreateSequence,
      handleApplyStaticPreset,
      handleApplyDynamicPreset,
      handleProgramNodeSelect: setSelectedProgramNodeId,
      handleChapterAdd,
      handleProgramItemInsert,
      handleProgramItemRemove,
      handleProgramItemMove,
      handleSave,
      lastPersistError,
      sequenceIssues,
    }),
    [
      sequences,
      sequence,
      selectedSequenceId,
      selection,
      selectedBlockId,
      selectedObjectIds,
      cursorMs,
      activeRightTab,
      selectedProgramNodeId,
      contextSelection,
      programs,
      timelineObjects,
      sequenceMissingHint,
      dockMode,
      timelinePxPerSecond,
      clipboardBlocks,
      lastPersistError,
      sequenceIssues,
      getTimelineObject,
      handleSequenceSelect,
      handleSelectionChange,
      handleObjectSelect,
      handleObjectsSelect,
      handleCursorChange,
      handleInsertTimelineBlock,
      handleReplaceTimelineBlock,
      handleApplyPoseAxisWrite,
      handleMoveTimelineBlock,
      handleShiftTimelineBlocks,
      handleShiftTimelineBlocksEnd,
      handleResizeDynamicPreset,
      handleUpdateSegmentSettings,
      handleBlockDelete,
      handleTrajectoryModeChange,
      handleLoopChange,
      handleBlockCopy,
      handleBlockPaste,
      handleTimelinePxPerSecondChange,
      handleTimelineZoomIn,
      handleTimelineZoomOut,
      handleCreatePose,
      handleCreateSetEnabled,
      handleCreateSequence,
      handleApplyStaticPreset,
      handleApplyDynamicPreset,
      handleChapterAdd,
      handleProgramItemInsert,
      handleProgramItemRemove,
      handleProgramItemMove,
      handleSave,
    ],
  );

  return (
    <ActionBuilderContext.Provider value={value}>{children}</ActionBuilderContext.Provider>
  );
};
