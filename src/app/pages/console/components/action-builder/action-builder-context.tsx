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
import { fitPresetParams } from "@/app/project/action-sequence/preset-defaults";
import { dynamicPresetProfileDurationMs, presetLabelOf } from "@/app/project/action-sequence/preset-registry";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import type { SequenceIssue } from "@/app/project/action-sequence/validate-sequence";
import { sequenceValidationContextFromSetup } from "@/app/project/project-motion-readiness";
import { allocateSequenceIdsInProject } from "@/app/project/action-sequence/sequence-id";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import {
  nextNewSequenceName,
  normalizeSequenceName,
  sequenceNameError,
} from "@/app/project/action-sequence/sequence-name";
import type { ActionSequenceConfig, ModelPose, MotionSegmentSettings, TimelineBlock } from "@/app/project/action-sequence/types";
import {
  actionSequencePathIsClosed,
  reconcileSequenceLoop,
  SEQUENCE_LOOP_CLEARED_TOAST,
} from "@/app/project/action-sequence/sequence-loop";
import type { ProjectMotion, VirtualAxisId } from "@/app/project/project-document-types";
import {
  createEmptySequence,
  DEFAULT_BLOCK_MS,
  nextId,
} from "./action-builder-ops";
import {
  actionClipboard,
  buildPastedSequence,
  matchClipboardObjects,
  retargetToSelectedObjects,
  useActionClipboard,
  type ClipboardObject,
} from "./action-clipboard";
import {
  applyPoseAxisWrite,
  copyTimelineBlocks,
  deleteTimelineBlocks,
  insertTimelineBlock,
  type ObjectIdMap,
  type PasteResult,
  type PoseAxisWrite,
  type SequenceEditError,
  type SequenceEditOptions,
  moveTimelineBlock,
  pasteTimelineBlocks,
  timelineClipboardObjectIds,
  upsertPoseBlock,
  upsertSetEnabledBlock,
  type UpsertResult,
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
  renameSequenceInProgramTree,
  stripSequenceFromProgramTree,
  TIMELINE_PX_PER_SECOND_DEFAULT,
  TIMELINE_ZOOM_FACTOR,
  formatTime,
  snapTimeMs,
  type ControlledObject as TimelineControlledObject,
  type ProgramNode,
} from "./timeline/timeline-data";
import type {
  ActionBuilderContextValue,
  EditorDockMode,
  ProgramItemInput,
} from "./action-builder-context-types";
import { ActionBuilderContext } from "./action-builder-react-context";
import type { ContextSelection } from "./context-bar/selection-context-bar";
import type { ActionRightTab } from "./right-panel/action-right-panel";

export { useActionBuilder } from "./use-action-builder";

const PASTE_ERROR_MESSAGE: Record<SequenceEditError, string> = {
  "motion-overlap": "粘贴位置和已有动作重叠，请换个时间或物体再粘贴",
  "time-conflict": "粘贴位置上该物体已有动作块，请换个时间或物体再粘贴",
  "invalid-time-range": "粘贴后的时间不合法",
  "invalid-preset": "预设不适用于目标物体",
  "missing-block": "粘贴失败",
};

/** 插入块被拒时的提示；其他原因保持原来的静默 */
const INSERT_ERROR_MESSAGE: Partial<Record<SequenceEditError, string>> = {
  "motion-overlap": "该时刻和物体已有的动作重叠，无法插入",
  "time-conflict": "所选物体在该时刻已有动作块，无法插入",
};

/** 在播放头位置给多个物体新建或更新动作块的结果 */
type UpsertOutcome = {
  committed: boolean;
  blockIds: string[];
  /** 该时刻已有同类块、被更新的个数 */
  updated: number;
  /** 该时刻已有其他动作（如预设关键点）而没插入的物体名 */
  refusedNames: string[];
};

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
  const clipboard = useActionClipboard();
  /** 物体选择每变一次加一；用来判断复制之后用户有没有重新选物体 */
  const objectSelectionVersionRef = useRef(0);
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

  useEffect(() => {
    objectSelectionVersionRef.current += 1;
  }, [selectedObjectIds]);

  /** 当前工程的物体，按时间轴轨道顺序 */
  const projectClipboardObjects = useCallback(
    (): ClipboardObject[] =>
      (currentProject?.document?.setup.controlledObjects ?? []).map((object) => ({
        id: object.id,
        name: object.name,
        controlType: object.controlType,
      })),
    [currentProject?.document],
  );

  const describeClipboardObjects = useCallback(
    (objectIds: Iterable<number>): ClipboardObject[] => {
      const known = projectClipboardObjects();
      const order = new Map(known.map((object, index) => [object.id, index]));
      return [...new Set(objectIds)]
        .map(
          (id) =>
            known.find((object) => object.id === id) ?? { id, name: `物体 ${id}`, controlType: -1 },
        )
        .sort(
          (left, right) =>
            (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );
    },
    [projectClipboardObjects],
  );

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

  const handlePlaybackCursorChange = useCallback((ms: number) => {
    setCursorMs(Math.max(0, ms));
  }, []);

  const sequenceEditOptions = useMemo<SequenceEditOptions>(
    () => ({
      minAccelTimeByObject: (objectId) => getTimelineObject(objectId)?.minAccelTimeByAxis,
    }),
    [getTimelineObject],
  );

  const handleInsertTimelineBlock = useCallback(
    (block: TimelineBlock): boolean => {
      let failure: SequenceEditError | null = null;
      const ok = applySequenceEdit((current) => {
        const result = insertTimelineBlock(current, block, sequenceEditOptions);
        failure = result.ok ? null : result.reason;
        return result;
      });
      const message = failure ? INSERT_ERROR_MESSAGE[failure as SequenceEditError] : undefined;
      if (message) toast.warning(message);
      return ok;
    },
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

  /** 逐个物体在播放头位置新建或更新动作块，一次提交 */
  const upsertForObjects = useCallback(
    (
      objectIds: number[],
      upsert: (current: ActionSequenceConfig, objectId: number) => UpsertResult,
    ): UpsertOutcome => {
      const outcome: UpsertOutcome = { committed: false, blockIds: [], updated: 0, refusedNames: [] };
      outcome.committed = updateSelectedSequence((current) => {
        let next = current;
        for (const objectId of objectIds) {
          const result = upsert(next, objectId);
          if (!result.ok) {
            outcome.refusedNames.push(getTimelineObject(objectId)?.name ?? `物体 ${objectId}`);
            continue;
          }
          next = result.sequence;
          outcome.blockIds.push(result.blockId);
          if (result.updated) outcome.updated += 1;
        }
        return next === current ? null : next;
      });
      return outcome;
    },
    [updateSelectedSequence, getTimelineObject],
  );

  const reportUpsert = useCallback(
    (outcome: UpsertOutcome, label: string) => {
      const at = `${formatTime(snapTimeMs(cursorMs))}s`;
      if (outcome.refusedNames.length > 0) {
        toast.warning(`${outcome.refusedNames.join("、")} 在 ${at} 已有其他动作，未插入${label}`);
      }
      if (!outcome.committed) return;
      if (outcome.updated > 0) toast.success(`已更新 ${outcome.updated} 个物体在 ${at} 的${label}`);
      setSelection(selectionFromBlockIds(outcome.blockIds));
      setSequenceMissingHint(false);
    },
    [cursorMs],
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
      const outcome = upsertForObjects(objectIds, (current, objectId) =>
        upsertPoseBlock(
          current,
          { id: nextId("blk"), kind: "pose", objectId, atMs: cursorMs, pose: poseForObject(objectId) },
          sequenceEditOptions,
        ),
      );
      reportUpsert(outcome, "位姿");
    },
    [selectedSequenceId, sequence, cursorMs, poseForObject, sequenceEditOptions],
  );

  const handleCreateSetEnabled = useCallback(
    (objectIds: number[], enabled: boolean) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const outcome = upsertForObjects(objectIds, (current, objectId) =>
        upsertSetEnabledBlock(current, {
          id: nextId("blk"),
          kind: "instruction",
          presetId: "set-enabled",
          objectId,
          atMs: cursorMs,
          instr: { enabled },
        }),
      );
      reportUpsert(outcome, enabled ? "使能指令" : "断使能指令");
    },
    [selectedSequenceId, sequence, cursorMs],
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
      const next = createEmptySequence(
        id,
        nextNewSequenceName(motionRef.current.sequences.map((sequence) => sequence.name)),
      );
      const nextSequences = [...motionRef.current.sequences, next];
      if (!commitMotionProjection({ ...motionRef.current, sequences: nextSequences })) return;
      handleSequenceSelect(next.id);
    },
    [commitMotionProjection, handleSequenceSelect],
  );

  const handleRenameSequence = useCallback(
    (raw: string): string | null => {
      if (selectedSequenceId === null) return "未选择序列";
      const current = motionRef.current.sequences.find((item) => item.id === selectedSequenceId);
      if (!current) return "未选择序列";
      const others = motionRef.current.sequences
        .filter((item) => item.id !== current.id)
        .map((item) => item.name);
      const error = sequenceNameError(raw, others);
      if (error) return error;
      const name = normalizeSequenceName(raw);
      if (name === current.name) return null;
      const sequences = motionRef.current.sequences.map((item) =>
        item.id === current.id ? { ...item, name } : item,
      );
      const programs = renameSequenceInProgramTree(motionRef.current.programs, current.id, name);
      if (!commitMotionProjection({ sequences, programs })) return "重命名失败";
      return null;
    },
    [selectedSequenceId, commitMotionProjection],
  );

  const handleDeleteSequence = useCallback(() => {
    const id = selectedSequenceId;
    if (id === null) return;
    const remaining = motionRef.current.sequences.filter((seq) => seq.id !== id);
    if (remaining.length === motionRef.current.sequences.length) return;
    const nextPrograms = stripSequenceFromProgramTree(motionRef.current.programs, id);
    if (!commitMotionProjection({ sequences: remaining, programs: nextPrograms })) return;
    setSelectedProgramNodeId((prev) => (prev === String(id) ? null : prev));
    handleSequenceSelect(remaining[0]?.id ?? null);
  }, [selectedSequenceId, commitMotionProjection, handleSequenceSelect]);

  const handleApplyStaticPreset = useCallback(
    (presetId: string, objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      if (objectIds.length < 2) return;
      const fitted = fitPresetParams(
        presetId,
        objectIds.map((objectId) => {
          const object = getTimelineObject(objectId);
          return {
            id: objectId,
            rangeByAxis: object?.rangeByAxis,
            maxSpeedByAxis: object?.maxSpeedByAxis,
            minAccelTimeByAxis: object?.minAccelTimeByAxis,
          };
        }),
      );
      if (!fitted) return;
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "static-preset",
        presetId,
        atMs: cursorMs,
        orderedObjectIds: [...objectIds],
        params: fitted.params,
        label: presetLabelOf(presetId),
      };
      if (!handleInsertTimelineBlock(block)) return;
      setSelection({ kind: "block", blockId: block.id });
      setSequenceMissingHint(false);
    },
    [selectedSequenceId, sequence, cursorMs, handleInsertTimelineBlock, getTimelineObject],
  );

  const handleApplyDynamicPreset = useCallback(
    (presetId: string, objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      if (objectIds.length < 2) return;
      const participants = objectIds.map((objectId) => {
        const object = getTimelineObject(objectId);
        return {
          id: objectId,
          rangeByAxis: object?.rangeByAxis,
          maxSpeedByAxis: object?.maxSpeedByAxis,
          minAccelTimeByAxis: object?.minAccelTimeByAxis,
        };
      });
      const fitted = fitPresetParams(presetId, participants);
      if (!fitted) return;
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
      const durationMs = fitted.durationMs > 0 ? fitted.durationMs : DEFAULT_BLOCK_MS;
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "dynamic-preset",
        presetId,
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
        orderedObjectIds: [...objectIds],
        params: fitted.params,
        label: presetLabelOf(presetId),
        profiles: createDefaultAxisProfiles(
          dynamicPresetProfileDurationMs({
            presetId,
            startMs: cursorMs,
            endMs: cursorMs + durationMs,
            orderedObjectIds: [...objectIds],
            params: fitted.params,
          }),
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
    const copied = copyTimelineBlocks(sequence, selectedBlockIds);
    if (copied.blocks.length === 0) return;
    actionClipboard.setBlocks({
      ...copied,
      projectId: currentProject?.id ?? null,
      objectSelectionVersion: objectSelectionVersionRef.current,
      objects: describeClipboardObjects(timelineClipboardObjectIds(copied)),
    });
    toast.success(`已复制 ${copied.blocks.length} 个动作块`);
  }, [selectedBlockIds, sequence, currentProject?.id, describeClipboardObjects]);

  /**
   * 粘贴到播放头位置。复制后重新选了物体（或换了工程且选了物体）就粘贴到选中的物体上；
   * 否则粘贴回原来的物体，换了工程时按 id / 名称找对应物体。
   */
  const handleBlockPaste = useCallback(() => {
    const copied = actionClipboard.get().blocks;
    if (!copied || copied.blocks.length === 0 || !selectedSequenceId) return;
    const sameProject = copied.projectId === (currentProject?.id ?? null);
    const reselected =
      !sameProject || copied.objectSelectionVersion !== objectSelectionVersionRef.current;

    let objectMaps: ObjectIdMap[] | undefined;
    if (selectedObjectIds.length > 0 && reselected) {
      const trackOrder = new Map(timelineObjects.map((object, index) => [object.id, index]));
      const targetIds = [...selectedObjectIds].sort(
        (left, right) => (trackOrder.get(left) ?? 0) - (trackOrder.get(right) ?? 0),
      );
      const retargeted = retargetToSelectedObjects(copied.objects, targetIds);
      if (!retargeted.ok) {
        toast.warning(retargeted.message);
        return;
      }
      objectMaps = retargeted.maps;
    } else if (!sameProject) {
      objectMaps = [matchClipboardObjects(copied.objects, projectClipboardObjects())];
    }

    let result: PasteResult | null = null;
    updateSelectedSequence((current) => {
      const pasted = pasteTimelineBlocks(current, copied, cursorMs, sequenceEditOptions, objectMaps);
      result = pasted;
      return pasted.ok && pasted.createdIds.length > 0 ? pasted.sequence : null;
    });
    const outcome = result as PasteResult | null;
    if (!outcome) return;
    if (!outcome.ok) {
      toast.warning(PASTE_ERROR_MESSAGE[outcome.reason]);
      return;
    }
    if (outcome.droppedBlocks > 0) {
      toast.warning(`${outcome.droppedBlocks} 个动作块在当前工程里找不到对应物体，未粘贴`);
    }
    const createdIds = outcome.createdIds;
    if (createdIds.length === 0) return;
    setSelection(
      createdIds.length === 1
        ? { kind: "block", blockId: createdIds[0]! }
        : { kind: "multi-block", blockIds: createdIds },
    );
  }, [
    selectedSequenceId,
    currentProject?.id,
    selectedObjectIds,
    timelineObjects,
    projectClipboardObjects,
    updateSelectedSequence,
    cursorMs,
    sequenceEditOptions,
  ]);

  const handleSequenceCopy = useCallback(
    (sequenceId: number) => {
      const source = motionRef.current.sequences.find((item) => item.id === sequenceId);
      if (!source) return;
      actionClipboard.setSequence({
        projectId: currentProject?.id ?? null,
        sequence: source,
        objects: describeClipboardObjects(sequenceObjectIds(source)),
      });
      toast.success(`已复制动作序列「${source.name}」`);
    },
    [currentProject?.id, describeClipboardObjects],
  );

  /** 粘贴成一条新序列（可来自别的工程），粘贴后选中它 */
  const handleSequencePaste = useCallback(() => {
    const copied = actionClipboard.get().sequence;
    if (!copied || !currentProject?.document) return;
    let id: number;
    try {
      [id] = allocateSequenceIdsInProject(motionRef.current.sequences, 1);
    } catch (error) {
      setLastPersistError(error instanceof Error ? error.message : "动作序列 id 已满（1~65535）");
      return;
    }
    const pasted = buildPastedSequence(
      copied,
      {
        id,
        existingNames: motionRef.current.sequences.map((item) => item.name),
        objects: projectClipboardObjects(),
      },
      sequenceEditOptions,
    );
    const reconciled = reconcileSequenceLoop(pasted.sequence);
    const nextSequences = [...motionRef.current.sequences, reconciled.sequence];
    if (!commitMotionProjection({ ...motionRef.current, sequences: nextSequences })) return;
    handleSequenceSelect(id);
    if (pasted.unmatchedObjectNames.length > 0) {
      toast.warning(
        `当前工程里找不到物体：${pasted.unmatchedObjectNames.join("、")}，相关的 ${pasted.droppedBlocks} 个动作块未粘贴`,
      );
    }
    if (reconciled.cleared) toast.warning(SEQUENCE_LOOP_CLEARED_TOAST);
  }, [
    currentProject?.document,
    projectClipboardObjects,
    sequenceEditOptions,
    commitMotionProjection,
    handleSequenceSelect,
  ]);

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
      canPasteBlock: (clipboard.blocks?.blocks.length ?? 0) > 0,
      canPasteSequence: clipboard.sequence !== null,
      setActiveRightTab,
      handleSequenceSelect,
      handleSelectionChange,
      handleObjectSelect,
      handleObjectsSelect,
      handleCursorChange,
      handlePlaybackCursorChange,
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
      handleSequenceCopy,
      handleSequencePaste,
      handleTimelinePxPerSecondChange,
      handleTimelineZoomIn,
      handleTimelineZoomOut,
      handleCreatePose,
      handleCreateSetEnabled,
      handleCreateSequence,
      handleRenameSequence,
      handleDeleteSequence,
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
      clipboard,
      lastPersistError,
      sequenceIssues,
      getTimelineObject,
      handleSequenceSelect,
      handleSelectionChange,
      handleObjectSelect,
      handleObjectsSelect,
      handleCursorChange,
      handlePlaybackCursorChange,
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
      handleSequenceCopy,
      handleSequencePaste,
      handleTimelinePxPerSecondChange,
      handleTimelineZoomIn,
      handleTimelineZoomOut,
      handleCreatePose,
      handleCreateSetEnabled,
      handleCreateSequence,
      handleRenameSequence,
      handleDeleteSequence,
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
