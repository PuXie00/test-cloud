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
import {
  buildCapturedPoseSequence,
  type CapturedPoseRequest,
} from "@/app/project/capture-pose-sequence";
import { useProject } from "@/app/project/use-project";
import { evaluateResolvedSequence } from "@/app/project/action-sequence/evaluate-sequence";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import {
  resolveActionSequence,
  uncontrolledAxesOf,
  type ResolvedActionSequence,
} from "@/app/project/action-sequence/resolve-sequence";
import { roundProjectCoordinate } from "@/app/project/project-quantity";
import { fitPresetParams } from "@/app/project/action-sequence/preset-defaults";
import {
  dynamicPresetProfileDurationMs,
  getPresetDefinition,
  presetLabelOf,
  presetObjectConditionMessage,
} from "@/app/project/action-sequence/preset-registry";
import { layoutParticipants, type LayoutPoint } from "@/app/project/action-sequence/preset-layout";
import { objectWorldPose } from "@/app/project/object-mount";
import { validateActionSequence } from "@/app/project/action-sequence/validate-sequence";
import type { SequenceIssue } from "@/app/project/action-sequence/validate-sequence";
import {
  getSequenceContentRepairIssue,
  sequenceValidationContextFromSetup,
} from "@/app/project/project-motion-readiness";
import { allocateSequenceIdsInProject } from "@/app/project/action-sequence/sequence-id";
import { sequenceObjectIds } from "@/app/project/action-sequence/sequence-object-ids";
import {
  nextNewSequenceName,
  normalizeSequenceName,
  sequenceNameError,
} from "@/app/project/action-sequence/sequence-name";
import type {
  ActionSequenceConfig,
  KeyframePose,
  ModelPose,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import {
  actionSequencePathIsClosed,
  reconcileSequenceLoop,
  SEQUENCE_LOOP_CLEARED_TOAST,
} from "@/app/project/action-sequence/sequence-loop";
import type {
  ProjectMotion,
  VirtualAxisId,
  VirtualAxisValues,
} from "@/app/project/project-document-types";
import {
  createEmptySequence,
  DEFAULT_BLOCK_MS,
  nextId,
} from "./action-builder-ops";
import {
  actionClipboard,
  buildPastedSequence,
  retargetToSelectedObjects,
  useActionClipboard,
  type ClipboardObject,
} from "./action-clipboard";
import {
  applyPoseAxisWrite,
  changedPoseIds,
  copyTimelineBlocks,
  deleteTimelineBlocks,
  explodePresetBlocks,
  insertTimelineBlock,
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
  updatePosesFromLive,
  updateSegmentSettings,
  writeSegmentProfiles,
  type EditResult,
  type SegmentProfileWrite,
} from "./sequence-ops";
import {
  pruneSequenceSelection,
  selectionBlockIds,
  selectionFromBlockIds,
  selectionMarkerIds,
  type SequenceSelection,
} from "./sequence-selection";
import {
  addMarker,
  deleteMarkers,
  newMarkerId,
  renameMarker,
  setMarkerTime,
  shiftMarkers,
} from "./marker-ops";
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
import { LivePoseBridge, type LivePoseLookup } from "./live-pose-bridge";
import type { PhaseInputMode } from "./motion-profile/phase-rates";
import type { CurveGraph, TimelineViewMode } from "./timeline/curve-data";
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

type SequenceDrafts = ReadonlyMap<number, ActionSequenceConfig>;

const NO_DRAFTS: SequenceDrafts = new Map();

const sameSequence = (left: ActionSequenceConfig, right: ActionSequenceConfig): boolean =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

/**
 * 动作编辑页撤销一步记下的状态：编辑器里看到的序列（有草稿用草稿）、当时已保存的版本、节目列表。
 * 和搭建的工程历史分开；保存不算一步，撤销时内容和当前已保存的不同就变回草稿。
 */
type EditorSnapshot = {
  sequences: readonly ActionSequenceConfig[];
  applied: ReadonlyMap<number, ActionSequenceConfig>;
  programs: ProgramNode[];
};

type EditorHistory = { past: EditorSnapshot[]; future: EditorSnapshot[] };

const EDITOR_HISTORY_LIMIT = 100;

const EMPTY_EDITOR_HISTORY: EditorHistory = { past: [], future: [] };

const sameSnapshot = (left: EditorSnapshot, right: EditorSnapshot): boolean =>
  left.programs === right.programs &&
  left.sequences.length === right.sequences.length &&
  left.sequences.every((item, index) => item === right.sequences[index]);

/** 两步之间看到的内容变了的序列，含新增和删除 */
const changedSequenceIds = (from: EditorSnapshot, to: EditorSnapshot): number[] => {
  const before = new Map(from.sequences.map((item) => [item.id, item]));
  const after = new Map(to.sequences.map((item) => [item.id, item]));
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  );
};

const UNREPAIRED_SAVE_MESSAGE = "动作序列有待修复的问题，请先修复再保存";
const EMPTY_SAVE_MESSAGE = "动作序列为空，请先编排再保存";

export const ActionBuilderProvider = ({ children }: { children: ReactNode }) => {
  const { currentProject, updateCurrentDocument, documentRevision } = useProject();

  /** 工程里已保存的序列：节目列表、执行、预览用这一份 */
  const [appliedSequences, setAppliedSequences] = useState<ActionSequenceConfig[]>([]);
  /**
   * 序列内容（动作块、标记、强制轨迹、循环）的草稿，只在内存里；按「保存」才写进工程。
   * 重命名、新建、删除、加入节目不走草稿，立即生效。
   */
  const [drafts, setDrafts] = useState<SequenceDrafts>(NO_DRAFTS);
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
  const [lastPersistError, setLastPersistError] = useState<string | null>(null);
  // 拖块、在曲线上拖值的过程中不跑校验，松手再跑
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [sequenceIssues, setSequenceIssues] = useState<SequenceIssue[]>([]);
  const shiftOriginRef = useRef<ActionSequenceConfig | null>(null);
  const poseDragOriginRef = useRef<ActionSequenceConfig | null>(null);
  const markerShiftOriginRef = useRef<ActionSequenceConfig | null>(null);
  const selectedBlockIds = selectionBlockIds(selection);
  const selectedBlockId = selectedBlockIds[0] ?? null;

  const motionRef = useRef<MotionProjection>({ sequences: appliedSequences, programs });
  const draftsRef = useRef<SequenceDrafts>(drafts);
  /** 编辑器里看到的序列：有草稿的用草稿 */
  const sequences = useMemo(
    () =>
      drafts.size === 0
        ? appliedSequences
        : appliedSequences.map((item) => drafts.get(item.id) ?? item),
    [appliedSequences, drafts],
  );
  const draftSequenceIds = useMemo<ReadonlySet<number>>(() => new Set(drafts.keys()), [drafts]);

  const replaceDrafts = useCallback((next: SequenceDrafts) => {
    if (next === draftsRef.current) return;
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  /** next 为 null 时删掉该序列的草稿 */
  const setDraft = useCallback(
    (sequenceId: number, next: ActionSequenceConfig | null) => {
      const current = draftsRef.current;
      if (next === null && !current.has(sequenceId)) return;
      const map = new Map(current);
      if (next === null) map.delete(sequenceId);
      else map.set(sequenceId, next);
      replaceDrafts(map);
    },
    [replaceDrafts],
  );

  const editorHistoryRef = useRef<EditorHistory>(EMPTY_EDITOR_HISTORY);
  const [editorHistory, setEditorHistory] = useState<EditorHistory>(EMPTY_EDITOR_HISTORY);
  /** 正在记的这一步开始前的状态；嵌套操作、拖动从按下到松手都并进这一步 */
  const pendingStepRef = useRef<EditorSnapshot | null>(null);
  /** 这一步要等松手（拖动结束或指针抬起）才记 */
  const openStepRef = useRef(false);
  /** 指针按着：期间的编辑（拖曲线手柄、拖块等）合成一步 */
  const pointerDownRef = useRef(false);

  const replaceEditorHistory = useCallback((next: EditorHistory) => {
    editorHistoryRef.current = next;
    setEditorHistory(next);
  }, []);

  const clearEditorHistory = useCallback(() => {
    pendingStepRef.current = null;
    openStepRef.current = false;
    if (editorHistoryRef.current !== EMPTY_EDITOR_HISTORY) replaceEditorHistory(EMPTY_EDITOR_HISTORY);
  }, [replaceEditorHistory]);

  const captureEditor = useCallback((): EditorSnapshot => {
    const applied = motionRef.current.sequences;
    const drafted = draftsRef.current;
    return {
      sequences: drafted.size === 0 ? applied : applied.map((item) => drafted.get(item.id) ?? item),
      applied: new Map(applied.map((item) => [item.id, item])),
      programs: motionRef.current.programs,
    };
  }, []);

  const pushEditorStep = useCallback(
    (before: EditorSnapshot) => {
      if (sameSnapshot(before, captureEditor())) return;
      replaceEditorHistory({
        past: [...editorHistoryRef.current.past, before].slice(-EDITOR_HISTORY_LIMIT),
        future: [],
      });
    },
    [captureEditor, replaceEditorHistory],
  );

  /** 开一步，等松手再记 */
  const openEditorStep = useCallback(() => {
    if (pendingStepRef.current) return;
    pendingStepRef.current = captureEditor();
    openStepRef.current = true;
  }, [captureEditor]);

  /** 记下等松手的那一步 */
  const finishOpenStep = useCallback(() => {
    if (!openStepRef.current) return;
    const before = pendingStepRef.current;
    openStepRef.current = false;
    pendingStepRef.current = null;
    if (before) pushEditorStep(before);
  }, [pushEditorStep]);

  /** 把一次操作记成一步撤销；指针按着时并进这次按住的一步 */
  const recordEditorStep = useCallback(
    <T,>(run: () => T): T => {
      if (pendingStepRef.current) return run();
      if (pointerDownRef.current) {
        openEditorStep();
        return run();
      }
      const before = captureEditor();
      pendingStepRef.current = before;
      try {
        return run();
      } finally {
        pendingStepRef.current = null;
        pushEditorStep(before);
      }
    },
    [captureEditor, pushEditorStep, openEditorStep],
  );

  /** 时间轴拖动开始：之后每次移动都并进这一步，松手（endDragStep）才记 */
  const beginDragStep = openEditorStep;
  const endDragStep = finishOpenStep;

  // 指针从按下到抬起之间的编辑合成一步：曲线手柄、预设面板等拖动控件不用各自接开始 / 结束
  useEffect(() => {
    const onDown = () => {
      pointerDownRef.current = true;
    };
    const onUp = () => {
      pointerDownRef.current = false;
      finishOpenStep();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp);
    };
  }, [finishOpenStep]);
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
      setAppliedSequences(next.sequences);
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
        setAppliedSequences([]);
        replaceDrafts(NO_DRAFTS);
        clearEditorHistory();
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

    // 换工程，或动作数据在编辑器外被改了（搭建删物体、搭建撤销、AI、控制页改节目）：
    // 旧的撤销记录对不上了，清空
    if (projectChanged || document.motion !== hydratedMotionRef.current) clearEditorHistory();
    hydratingRef.current = true;
    motionRef.current = {
      sequences: bundle.sequences,
      programs: bundle.programs,
    };
    setAppliedSequences(bundle.sequences);
    // 换工程清空草稿；同一工程里序列被删（撤销、删物体等）时丢掉它的草稿
    if (projectChanged) {
      replaceDrafts(NO_DRAFTS);
    } else if (draftsRef.current.size > 0) {
      const ids = new Set(bundle.sequences.map((item) => item.id));
      const kept = [...draftsRef.current].filter(([id]) => ids.has(id));
      if (kept.length !== draftsRef.current.size) replaceDrafts(new Map(kept));
    }
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
  }, [currentProject?.id, currentProject?.document, documentRevision, replaceDrafts, clearEditorHistory]);

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
    if (isDraggingTimeline) return;
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
  }, [sequence, currentProject?.document, isDraggingTimeline]);

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

  /** 序列内容的编辑只改草稿；改回和已保存的一样时草稿自动消失 */
  const updateSelectedSequence = useCallback(
    (updater: (current: ActionSequenceConfig) => ActionSequenceConfig | null): boolean => {
      if (selectedSequenceId === null) return false;
      const applied = motionRef.current.sequences.find((item) => item.id === selectedSequenceId);
      if (!applied) return false;
      const current = draftsRef.current.get(selectedSequenceId) ?? applied;
      const next = updater(current);
      if (next === null || next === current) return false;
      const reconciled = reconcileSequenceLoop(next);
      if (reconciled.cleared) toast.warning(SEQUENCE_LOOP_CLEARED_TOAST);
      recordEditorStep(() =>
        setDraft(
          selectedSequenceId,
          sameSequence(reconciled.sequence, applied) ? null : reconciled.sequence,
        ),
      );
      return true;
    },
    [selectedSequenceId, setDraft, recordEditorStep],
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
      return recordEditorStep(() =>
        commitMotionProjection({ ...motionRef.current, programs: nextPrograms }),
      );
    },
    [commitMotionProjection, recordEditorStep],
  );

  const handleSequenceSelect = useCallback((sequenceId: number | null) => {
    setSelectedSequenceId(sequenceId);
    setSelection(null);
    setSequenceMissingHint(false);
    setCursorMs(0);
  }, []);

  const handleSelectionChange = useCallback((next: SequenceSelection) => {
    setSelection(next);
    // 手动控制（「当前位置」打开）是联机编辑：选块和清空选择都留在这个 tab，
    // 选中的位姿成为 GO 目标；其它 tab 选块时显示属性。
    setActiveRightTab((tab) => (tab === "manual" ? tab : "selection"));
    setSequenceMissingHint(false);
  }, []);

  // Picking objects keeps the manual-control tab: it acts on the selection.
  const handleObjectSelect = useCallback((objectId: number) => {
    setSelectedObjectIds([objectId]);
    setSelection(null);
    setActiveRightTab((tab) => (tab === "manual" ? tab : "selection"));
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
    setActiveRightTab((tab) => (tab === "manual" ? tab : "selection"));
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

  const poseObjectInfo = useCallback(
    (objectId: number) => {
      const object = getTimelineObject(objectId);
      if (object === undefined) return undefined;
      return {
        enabledAxes: object.enabledAxes,
        rangeByAxis: object.rangeByAxis,
      };
    },
    [getTimelineObject],
  );

  const handleApplyPoseAxisWrite = useCallback(
    (blockIds: readonly string[], write: PoseAxisWrite): boolean =>
      applySequenceEdit((current) =>
        applyPoseAxisWrite(current, blockIds, write, {
          ...sequenceEditOptions,
          objectInfo: poseObjectInfo,
        }),
      ),
    [applySequenceEdit, poseObjectInfo, sequenceEditOptions],
  );

  /** 曲线上拖位姿的值：所选位姿这根轴都加同样的增量，增量相对拖动开始，松手前不跑校验 */
  const handleDragPoseAxis = useCallback(
    (blockIds: readonly string[], axis: VirtualAxisId, deltaValue: number) => {
      setIsDraggingTimeline(true);
      beginDragStep();
      updateSelectedSequence((current) => {
        const origin = poseDragOriginRef.current ?? current;
        if (poseDragOriginRef.current === null) poseDragOriginRef.current = current;
        const result = applyPoseAxisWrite(
          origin,
          blockIds,
          { mode: "rel", axis, value: deltaValue },
          { ...sequenceEditOptions, objectInfo: poseObjectInfo },
        );
        return result.ok ? result.sequence : null;
      });
    },
    [updateSelectedSequence, poseObjectInfo, sequenceEditOptions, beginDragStep],
  );

  const handleDragPoseAxisEnd = useCallback(() => {
    poseDragOriginRef.current = null;
    setIsDraggingTimeline(false);
    endDragStep();
  }, [endDragStep]);

  /** 取当前：把物体的实时位置写进选中位姿里设定了值的轴 */
  const handleUpdatePosesFromLive = useCallback(
    (blockIds: readonly string[], liveFor: (objectId: number) => VirtualAxisValues | null) => {
      let updated = 0;
      let failed = false;
      const committed = applySequenceEdit((current) => {
        const result = updatePosesFromLive(current, blockIds, liveFor, {
          ...sequenceEditOptions,
          objectInfo: poseObjectInfo,
        });
        if (!result.ok) {
          failed = true;
          return result;
        }
        updated = changedPoseIds(current, result.sequence, blockIds).length;
        return result;
      });
      if (failed) {
        toast.error("位姿写入失败");
        return;
      }
      if (committed) {
        toast.success(`已用当前位置更新 ${updated} 个位姿`);
        return;
      }
      if (updated === 0) toast.info("位姿已和当前位置一致");
    },
    [applySequenceEdit, poseObjectInfo, sequenceEditOptions],
  );

  /** 拖单个块时连续调用；松手由 handleShiftTimelineBlocksEnd 结束，整次拖动记一步 */
  const handleMoveTimelineBlock = useCallback(
    (blockId: string, atMs: number) => {
      beginDragStep();
      updateSelectedSequence((current) =>
        moveTimelineBlock(current, blockId, atMs, sequenceEditOptions),
      );
    },
    [updateSelectedSequence, sequenceEditOptions, beginDragStep],
  );

  const handleShiftTimelineBlocks = useCallback(
    (blockIds: string[], deltaMs: number) => {
      setIsDraggingTimeline(true);
      beginDragStep();
      updateSelectedSequence((current) => {
        const origin = shiftOriginRef.current ?? current;
        if (shiftOriginRef.current === null) shiftOriginRef.current = current;
        return shiftTimelineBlocks(origin, blockIds, deltaMs, sequenceEditOptions);
      });
    },
    [updateSelectedSequence, sequenceEditOptions, beginDragStep],
  );

  const handleShiftTimelineBlocksEnd = useCallback(() => {
    shiftOriginRef.current = null;
    setIsDraggingTimeline(false);
    endDragStep();
  }, [endDragStep]);

  /** 拖动态预设边缘时连续调用；松手由 handleShiftTimelineBlocksEnd 结束，整次拖动记一步 */
  const handleResizeDynamicPreset = useCallback(
    (blockId: string, startMs: number, endMs: number): boolean => {
      beginDragStep();
      return applySequenceEdit((current) =>
        resizeDynamicPreset(current, blockId, startMs, endMs, sequenceEditOptions),
      );
    },
    [applySequenceEdit, sequenceEditOptions, beginDragStep],
  );

  const handleUpdateSegmentSettings = useCallback(
    (fromRef: string, toRef: string, settings: MotionSegmentSettings) => {
      updateSelectedSequence((current) => updateSegmentSettings(current, fromRef, toRef, settings));
    },
    [updateSelectedSequence],
  );

  const handleWriteSegmentProfiles = useCallback(
    (writes: readonly SegmentProfileWrite[]): boolean =>
      updateSelectedSequence((current) => writeSegmentProfiles(current, writes)),
    [updateSelectedSequence],
  );

  const [phaseInputMode, setPhaseInputMode] = useState<PhaseInputMode>("time");
  // 时间轴看轨道还是曲线、曲线看哪根轴、看位置还是速度：离开动作页再回来也保持
  const [timelineViewMode, setTimelineViewMode] = useState<TimelineViewMode>("tracks");
  const [curveAxis, setCurveAxis] = useState<VirtualAxisId>("v1");
  const [curveGraph, setCurveGraph] = useState<CurveGraph>("position");

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

  /** 在指定时刻（默认播放头）加标记并选中它，返回新标记的 id */
  const handleAddMarker = useCallback(
    (atMs?: number): string | null => {
      let markerId: string | null = null;
      const committed = updateSelectedSequence((current) => {
        markerId = newMarkerId(current.markers ?? []);
        return addMarker(current, { id: markerId, atMs: atMs ?? cursorMs });
      });
      if (!committed || markerId === null) return null;
      setSelection({ kind: "markers", markerIds: [markerId] });
      setActiveRightTab((tab) => (tab === "manual" ? tab : "selection"));
      return markerId;
    },
    [cursorMs, updateSelectedSequence],
  );

  const handleRenameMarker = useCallback(
    (markerId: string, name: string): boolean =>
      updateSelectedSequence((current) => renameMarker(current, markerId, name)),
    [updateSelectedSequence],
  );

  const handleSetMarkerTime = useCallback(
    (markerId: string, atMs: number): boolean =>
      updateSelectedSequence((current) => setMarkerTime(current, markerId, atMs)),
    [updateSelectedSequence],
  );

  /** 拖标记：相对拖动开始时的序列平移，松手前都算一次编辑 */
  const handleShiftMarkers = useCallback(
    (markerIds: readonly string[], deltaMs: number) => {
      beginDragStep();
      updateSelectedSequence((current) => {
        const origin = markerShiftOriginRef.current ?? current;
        if (markerShiftOriginRef.current === null) markerShiftOriginRef.current = current;
        return shiftMarkers(origin, markerIds, deltaMs);
      });
    },
    [updateSelectedSequence, beginDragStep],
  );

  const handleShiftMarkersEnd = useCallback(() => {
    markerShiftOriginRef.current = null;
    endDragStep();
  }, [endDragStep]);

  const handleDeleteMarkers = useCallback(
    (markerIds?: readonly string[]) => {
      const ids = markerIds ?? selectionMarkerIds(selection);
      if (ids.length === 0) return;
      if (!updateSelectedSequence((current) => deleteMarkers(current, ids))) return;
      setSelection((current) => {
        const remaining = selectionMarkerIds(current).filter((id) => !ids.includes(id));
        if (current?.kind !== "markers") return current;
        return remaining.length === 0 ? null : { kind: "markers", markerIds: remaining };
      });
    },
    [selection, updateSelectedSequence],
  );

  const handleExplodePresets = useCallback(
    (blockIds?: readonly string[]) => {
      const ids = blockIds ?? selectedBlockIds;
      let createdIds: string[] = [];
      const committed = applySequenceEdit((current) => {
        const result = explodePresetBlocks(current, ids, sequenceEditOptions);
        if (result.ok) createdIds = result.createdIds;
        return result;
      });
      if (!committed) {
        toast.warning("预设无法拆解");
        return;
      }
      setSelection(selectionFromBlockIds(createdIds));
      toast.success(`已拆成 ${createdIds.length} 个位姿`);
    },
    [applySequenceEdit, selectedBlockIds, sequenceEditOptions],
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

  const livePoseRef = useRef<LivePoseLookup | null>(null);
  const getLivePose = useCallback(
    (objectId: number): ModelPose | null => livePoseRef.current?.(objectId) ?? null,
    [],
  );

  /**
   * 新建位姿的默认值：序列里已有该物体时取指针处的序列值（原轨迹不变），序列不控制的轴仍不设定；
   * 没有时取实时位置。指针处已有位姿就原样保留（包括不设定的轴）。
   */
  const defaultPosesAtCursor = useCallback(
    (target: ActionSequenceConfig, objectIds: readonly number[]): Map<number, KeyframePose> => {
      let resolved: ResolvedActionSequence | null = null;
      let evaluated = new Map<number, ModelPose>();
      try {
        resolved = resolveActionSequence(target);
        evaluated = evaluateResolvedSequence(resolved, cursorMs);
      } catch {
        // 序列解析失败时全部退回实时位置
      }
      return new Map(
        objectIds.map((objectId): [number, KeyframePose] => {
          const existing = target.blocks.find(
            (block) => block.kind === "pose" && block.objectId === objectId && block.atMs === cursorMs,
          );
          if (existing?.kind === "pose") return [objectId, { ...existing.pose }];
          const pose = evaluated.get(objectId);
          if (!pose) return [objectId, getLivePose(objectId) ?? { v1: 0, v2: 0, v3: 0 }];
          const uncontrolled = resolved ? uncontrolledAxesOf(resolved, objectId) : [];
          const next: KeyframePose = {};
          for (const axis of ["v1", "v2", "v3"] as const) {
            if (!uncontrolled.includes(axis)) next[axis] = roundProjectCoordinate(pose[axis]);
          }
          return [objectId, next];
        }),
      );
    },
    [cursorMs, getLivePose],
  );

  const handleCreatePose = useCallback(
    (objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      const poses = defaultPosesAtCursor(sequence, objectIds);
      const outcome = upsertForObjects(objectIds, (current, objectId) =>
        upsertPoseBlock(
          current,
          { id: nextId("blk"), kind: "pose", objectId, atMs: cursorMs, pose: poses.get(objectId)! },
          sequenceEditOptions,
        ),
      );
      reportUpsert(outcome, "位姿");
    },
    [selectedSequenceId, sequence, cursorMs, defaultPosesAtCursor, sequenceEditOptions],
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
      if (!recordEditorStep(() => commitMotionProjection({ ...motionRef.current, sequences: nextSequences }))) {
        return;
      }
      handleSequenceSelect(next.id);
    },
    [commitMotionProjection, handleSequenceSelect, recordEditorStep],
  );

  /** 保存当前位姿：有选中序列则在播放头加位姿；否则新建序列（不加入节目）并选中 */
  const handleSaveCurrentPose = useCallback(
    ({ objectIds, poseForObject: livePoseFor }: CapturedPoseRequest) => {
      if (selectedSequenceId && sequence) {
        const poses = new Map<number, ModelPose>();
        for (const objectId of objectIds) {
          const pose = livePoseFor(objectId);
          if (pose) poses.set(objectId, pose);
        }
        if (poses.size === 0) return;
        const outcome = upsertForObjects([...poses.keys()], (current, objectId) =>
          upsertPoseBlock(
            current,
            { id: nextId("blk"), kind: "pose", objectId, atMs: cursorMs, pose: poses.get(objectId)! },
            sequenceEditOptions,
          ),
        );
        reportUpsert(outcome, "位姿");
        return;
      }
      let id: number;
      try {
        [id] = allocateSequenceIdsInProject(motionRef.current.sequences, 1);
      } catch (error) {
        setLastPersistError(error instanceof Error ? error.message : "动作序列 id 已满（1~65535）");
        return;
      }
      const created = buildCapturedPoseSequence({
        id,
        name: nextNewSequenceName(motionRef.current.sequences.map((item) => item.name)),
        objectIds,
        poseForObject: livePoseFor,
      });
      if (!created) return;
      const nextSequences = [...motionRef.current.sequences, created];
      if (!recordEditorStep(() => commitMotionProjection({ ...motionRef.current, sequences: nextSequences }))) {
        return;
      }
      handleSequenceSelect(created.id);
      toast.success(`已新建动作序列「${created.name}」`);
    },
    [
      selectedSequenceId,
      sequence,
      cursorMs,
      sequenceEditOptions,
      upsertForObjects,
      reportUpsert,
      commitMotionProjection,
      handleSequenceSelect,
    ],
  );

  const handleRenameSequence = useCallback(
    (raw: string, sequenceId: number | null = selectedSequenceId): string | null => {
      if (sequenceId === null) return "未选择序列";
      const current = motionRef.current.sequences.find((item) => item.id === sequenceId);
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
      return recordEditorStep(() => {
        if (!commitMotionProjection({ sequences, programs })) return "重命名失败";
        // 重命名立即生效，草稿跟着改名
        const draft = draftsRef.current.get(current.id);
        if (draft) setDraft(current.id, { ...draft, name });
        return null;
      });
    },
    [selectedSequenceId, commitMotionProjection, setDraft, recordEditorStep],
  );

  const handleDeleteSequence = useCallback(() => {
    const id = selectedSequenceId;
    if (id === null) return;
    const remaining = motionRef.current.sequences.filter((seq) => seq.id !== id);
    if (remaining.length === motionRef.current.sequences.length) return;
    const nextPrograms = stripSequenceFromProgramTree(motionRef.current.programs, id);
    const deleted = recordEditorStep(() => {
      if (!commitMotionProjection({ sequences: remaining, programs: nextPrograms })) return false;
      setDraft(id, null);
      return true;
    });
    if (!deleted) return;
    setSelectedProgramNodeId((prev) => (prev === String(id) ? null : prev));
    handleSequenceSelect(remaining[0]?.id ?? null);
  }, [selectedSequenceId, commitMotionProjection, handleSequenceSelect, setDraft, recordEditorStep]);

  /** 物体不符合预设条件时按该条件提示，返回 true 表示不能添加 */
  /** 物体在水平面上的世界坐标（挂载的物体按父物体换算），拿不到的按原点 */
  const layoutPointsFor = useCallback(
    (objectIds: readonly number[]): LayoutPoint[] => {
      const objects = currentProject?.document?.setup.controlledObjects ?? [];
      return objectIds.map((id) => {
        const position = objectWorldPose(objects, id)?.position;
        return { id, x: position?.x ?? 0, z: position?.z ?? 0 };
      });
    },
    [currentProject?.document],
  );

  /** 形状跟排列有关的预设按坐标排序，其余保持选择顺序 */
  const presetParticipants = useCallback(
    (presetId: string, objectIds: readonly number[]) =>
      getPresetDefinition(presetId)?.usesLayout
        ? layoutParticipants(layoutPointsFor(objectIds))
        : { orderedObjectIds: [...objectIds], layout: undefined },
    [layoutPointsFor],
  );

  /**
   * 按当前坐标重排预设：不传角度时沿用预设原来的方向（老预设取自动方向），"auto" 重新取自动方向。
   */
  const handleRelayoutPreset = useCallback(
    (blockId: string, angleDeg?: number | "auto") => {
      const block = sequence?.blocks.find((item) => item.id === blockId);
      if (!block || (block.kind !== "static-preset" && block.kind !== "dynamic-preset")) return;
      const angle = angleDeg === "auto" ? undefined : (angleDeg ?? block.layout?.angleDeg);
      const { orderedObjectIds, layout } = layoutParticipants(
        layoutPointsFor(block.orderedObjectIds),
        angle,
      );
      handleReplaceTimelineBlock({ ...block, orderedObjectIds, layout });
    },
    [sequence, layoutPointsFor, handleReplaceTimelineBlock],
  );

  const warnPresetObjectCondition = useCallback(
    (presetId: string, objectIds: readonly number[]): boolean => {
      const message = presetObjectConditionMessage(
        presetId,
        objectIds.map((id) => {
          const object = getTimelineObject(id);
          return { id, name: object?.name, controlType: object?.controlType };
        }),
      );
      if (message) toast.warning(message);
      return message !== null;
    },
    [getTimelineObject],
  );

  const handleApplyStaticPreset = useCallback(
    (presetId: string, objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      if (objectIds.length < 2) return;
      if (warnPresetObjectCondition(presetId, objectIds)) return;
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
      const { orderedObjectIds, layout } = presetParticipants(presetId, objectIds);
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "static-preset",
        presetId,
        atMs: cursorMs,
        orderedObjectIds,
        params: fitted.params,
        label: presetLabelOf(presetId),
        ...(layout ? { layout } : {}),
      };
      if (!handleInsertTimelineBlock(block)) return;
      setSelection({ kind: "block", blockId: block.id });
      setSequenceMissingHint(false);
    },
    [
      selectedSequenceId,
      sequence,
      cursorMs,
      handleInsertTimelineBlock,
      getTimelineObject,
      warnPresetObjectCondition,
      presetParticipants,
    ],
  );

  const handleApplyDynamicPreset = useCallback(
    (presetId: string, objectIds: number[]) => {
      if (!selectedSequenceId || !sequence) {
        setSequenceMissingHint(true);
        return;
      }
      if (objectIds.length < 2) return;
      if (warnPresetObjectCondition(presetId, objectIds)) return;
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
      const { orderedObjectIds, layout } = presetParticipants(presetId, objectIds);
      const block: TimelineBlock = {
        id: nextId("blk"),
        kind: "dynamic-preset",
        presetId,
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
        orderedObjectIds,
        params: fitted.params,
        label: presetLabelOf(presetId),
        ...(layout ? { layout } : {}),
        profiles: createDefaultAxisProfiles(
          dynamicPresetProfileDurationMs({
            presetId,
            startMs: cursorMs,
            endMs: cursorMs + durationMs,
            orderedObjectIds,
            params: fitted.params,
          }),
          Object.keys(mergedMinAccel).length > 0 ? mergedMinAccel : undefined,
        ),
      };
      if (!handleInsertTimelineBlock(block)) return;
      setSelection({ kind: "block", blockId: block.id });
      setSequenceMissingHint(false);
    },
    [
      selectedSequenceId,
      sequence,
      cursorMs,
      handleInsertTimelineBlock,
      getTimelineObject,
      warnPresetObjectCondition,
      presetParticipants,
    ],
  );

  const handleBlockCopy = useCallback(() => {
    if (selectedBlockIds.length === 0 || !sequence) return;
    const copied = copyTimelineBlocks(sequence, selectedBlockIds);
    if (copied.blocks.length === 0) return;
    actionClipboard.setBlocks({
      ...copied,
      projectId: currentProject?.id ?? null,
      objects: describeClipboardObjects(timelineClipboardObjectIds(copied)),
    });
    toast.success(`已复制 ${copied.blocks.length} 个动作块`);
  }, [selectedBlockIds, sequence, currentProject?.id, describeClipboardObjects]);

  /** 粘贴到播放头位置、当前选中的物体上；粘贴不成功都用警告提示原因 */
  const handleBlockPaste = useCallback(() => {
    const copied = actionClipboard.get().blocks;
    if (!copied || copied.blocks.length === 0) {
      toast.warning("还没有复制动作块");
      return;
    }
    if (selectedSequenceId === null) {
      toast.warning("请先选择要粘贴到的动作序列");
      return;
    }
    if (selectedObjectIds.length === 0) {
      toast.warning("请先选中要粘贴到的物体");
      return;
    }
    const trackOrder = new Map(timelineObjects.map((object, index) => [object.id, index]));
    const targetIds = [...selectedObjectIds].sort(
      (left, right) => (trackOrder.get(left) ?? 0) - (trackOrder.get(right) ?? 0),
    );
    const retargeted = retargetToSelectedObjects(copied.objects, targetIds);
    if (!retargeted.ok) {
      toast.warning(retargeted.message);
      return;
    }
    for (const objectMap of retargeted.maps) {
      for (const block of copied.blocks) {
        if (block.kind !== "static-preset" && block.kind !== "dynamic-preset") continue;
        const targets = block.orderedObjectIds.map((objectId) => objectMap.get(objectId));
        // Unmapped blocks are dropped by the paste itself.
        if (targets.some((objectId) => objectId === undefined)) continue;
        if (warnPresetObjectCondition(block.presetId, targets as number[])) return;
      }
    }

    let result: PasteResult | null = null;
    updateSelectedSequence((current) => {
      const pasted = pasteTimelineBlocks(
        current,
        copied,
        cursorMs,
        sequenceEditOptions,
        retargeted.maps,
      );
      result = pasted;
      return pasted.ok && pasted.createdIds.length > 0 ? pasted.sequence : null;
    });
    const outcome = result as PasteResult | null;
    if (!outcome || !outcome.ok || outcome.createdIds.length === 0) {
      toast.warning(outcome && !outcome.ok ? PASTE_ERROR_MESSAGE[outcome.reason] : "粘贴失败");
      return;
    }
    const createdIds = outcome.createdIds;
    setSelection(
      createdIds.length === 1
        ? { kind: "block", blockId: createdIds[0]! }
        : { kind: "multi-block", blockIds: createdIds },
    );
  }, [
    selectedSequenceId,
    selectedObjectIds,
    timelineObjects,
    updateSelectedSequence,
    cursorMs,
    sequenceEditOptions,
    warnPresetObjectCondition,
  ]);

  const handleSequenceCopy = useCallback(
    (sequenceId: number) => {
      // 复制编辑器里看到的内容，有草稿用草稿
      const source =
        draftsRef.current.get(sequenceId) ??
        motionRef.current.sequences.find((item) => item.id === sequenceId);
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
    if (!copied) {
      toast.warning("还没有复制动作序列");
      return;
    }
    if (!currentProject?.document) return;
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
    if (!recordEditorStep(() => commitMotionProjection({ ...motionRef.current, sequences: nextSequences }))) {
      return;
    }
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

  /** 把选中序列的草稿写进工程，节目列表、执行才用新内容；待修复时不保存（不是保存工程文件） */
  const handleSave = useCallback(() => {
    const id = selectedSequenceId;
    const document = currentProject?.document;
    if (id === null || !document) return;
    const draft = draftsRef.current.get(id);
    if (!draft) {
      toast.info("没有未保存的修改");
      return;
    }
    if (getSequenceContentRepairIssue(document, draft)) {
      toast.warning(draft.blocks.length === 0 ? EMPTY_SAVE_MESSAGE : UNREPAIRED_SAVE_MESSAGE);
      return;
    }
    const nextSequences = motionRef.current.sequences.map((item) => (item.id === id ? draft : item));
    if (!commitSequences(nextSequences)) {
      toast.error("保存失败");
      return;
    }
    setDraft(id, null);
    toast.success(`已保存「${draft.name}」，节目列表已更新`);
  }, [selectedSequenceId, currentProject?.document, commitSequences, setDraft]);

  /**
   * 退回到某一步：序列的增删、顺序、名字和节目列表写回工程；
   * 还在的序列保持当前已保存的版本（保存不撤销），看到的内容和它不同就作为草稿。
   */
  const restoreEditorSnapshot = useCallback(
    (target: EditorSnapshot): boolean => {
      const current = motionRef.current;
      const currentById = new Map(current.sequences.map((item) => [item.id, item]));
      const nextApplied: ActionSequenceConfig[] = [];
      const nextDrafts = new Map<number, ActionSequenceConfig>();
      for (const shown of target.sequences) {
        // 撤销删除时用删除前已保存的版本
        const base = currentById.get(shown.id) ?? target.applied.get(shown.id) ?? shown;
        const applied = base.name === shown.name ? base : { ...base, name: shown.name };
        nextApplied.push(applied);
        if (!sameSequence(shown, applied)) nextDrafts.set(shown.id, shown);
      }
      const appliedChanged =
        target.programs !== current.programs ||
        nextApplied.length !== current.sequences.length ||
        nextApplied.some((item, index) => item !== current.sequences[index]);
      if (appliedChanged && !commitMotionProjection({ sequences: nextApplied, programs: target.programs })) {
        return false;
      }
      replaceDrafts(nextDrafts);
      return true;
    },
    [commitMotionProjection, replaceDrafts],
  );

  /** 撤销 / 重做后切到被改的序列；改的就是当前序列或只改了节目列表时不切 */
  const focusRestoredSequence = useCallback(
    (from: EditorSnapshot, to: EditorSnapshot) => {
      const ids = new Set(to.sequences.map((item) => item.id));
      const changed = changedSequenceIds(from, to).filter((id) => ids.has(id));
      if (
        selectedSequenceId !== null &&
        ids.has(selectedSequenceId) &&
        (changed.length === 0 || changed.includes(selectedSequenceId))
      ) {
        setSelection((prev) => pruneSequenceSelection([...to.sequences], prev));
        return;
      }
      handleSequenceSelect(changed[0] ?? to.sequences[0]?.id ?? null);
    },
    [selectedSequenceId, handleSequenceSelect],
  );

  const stepEditorHistory = useCallback(
    (direction: "undo" | "redo"): boolean => {
      // 拖动没收到松手（如指针被系统取消）时先把它记完，免得一直撤销不了
      finishOpenStep();
      if (pendingStepRef.current) return false;
      const { past, future } = editorHistoryRef.current;
      const target = direction === "undo" ? past.at(-1) : future.at(-1);
      if (!target) return false;
      const current = captureEditor();
      if (!restoreEditorSnapshot(target)) return false;
      replaceEditorHistory(
        direction === "undo"
          ? { past: past.slice(0, -1), future: [...future, current] }
          : { past: [...past, current], future: future.slice(0, -1) },
      );
      focusRestoredSequence(current, target);
      return true;
    },
    [captureEditor, restoreEditorSnapshot, replaceEditorHistory, focusRestoredSequence, finishOpenStep],
  );

  const handleUndoEdit = useCallback(() => stepEditorHistory("undo"), [stepEditorHistory]);
  const handleRedoEdit = useCallback(() => stepEditorHistory("redo"), [stepEditorHistory]);

  const value = useMemo(
    (): ActionBuilderContextValue => ({
      sequences,
      draftSequenceIds,
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
      phaseInputMode,
      handlePhaseInputModeChange: setPhaseInputMode,
      timelineViewMode,
      handleTimelineViewModeChange: setTimelineViewMode,
      curveAxis,
      handleCurveAxisChange: setCurveAxis,
      curveGraph,
      handleCurveGraphChange: setCurveGraph,
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
      handleUpdatePosesFromLive,
      handleMoveTimelineBlock,
      handleShiftTimelineBlocks,
      handleShiftTimelineBlocksEnd,
      handleDragPoseAxis,
      handleDragPoseAxisEnd,
      handleResizeDynamicPreset,
      handleUpdateSegmentSettings,
      handleWriteSegmentProfiles,
      handleBlockDelete,
      handleExplodePresets,
      handleRelayoutPreset,
      handleAddMarker,
      handleRenameMarker,
      handleSetMarkerTime,
      handleShiftMarkers,
      handleShiftMarkersEnd,
      handleDeleteMarkers,
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
      handleSaveCurrentPose,
      getLivePose,
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
      canUndoEdit: editorHistory.past.length > 0,
      canRedoEdit: editorHistory.future.length > 0,
      handleUndoEdit,
      handleRedoEdit,
      lastPersistError,
      sequenceIssues,
    }),
    [
      sequences,
      draftSequenceIds,
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
      phaseInputMode,
      timelineViewMode,
      curveAxis,
      curveGraph,
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
      handleUpdatePosesFromLive,
      handleMoveTimelineBlock,
      handleShiftTimelineBlocks,
      handleShiftTimelineBlocksEnd,
      handleDragPoseAxis,
      handleDragPoseAxisEnd,
      handleResizeDynamicPreset,
      handleUpdateSegmentSettings,
      handleWriteSegmentProfiles,
      handleBlockDelete,
      handleExplodePresets,
      handleRelayoutPreset,
      handleAddMarker,
      handleRenameMarker,
      handleSetMarkerTime,
      handleShiftMarkers,
      handleShiftMarkersEnd,
      handleDeleteMarkers,
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
      handleSaveCurrentPose,
      getLivePose,
      handleRenameSequence,
      handleDeleteSequence,
      handleApplyStaticPreset,
      handleApplyDynamicPreset,
      handleChapterAdd,
      handleProgramItemInsert,
      handleProgramItemRemove,
      handleProgramItemMove,
      handleSave,
      editorHistory,
      handleUndoEdit,
      handleRedoEdit,
    ],
  );

  return (
    <ActionBuilderContext.Provider value={value}>
      <LivePoseBridge lookupRef={livePoseRef} />
      {children}
    </ActionBuilderContext.Provider>
  );
};
