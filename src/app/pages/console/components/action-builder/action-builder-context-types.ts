import type { TrajectoryMode } from "@shared/action-sequence";
import type {
  ActionSequenceConfig,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { SequenceIssue } from "@/app/project/action-sequence/validate-sequence";
import type { VirtualAxisId } from "@/app/project/project-document-types";
import type { ContextSelection } from "./context-bar/selection-context-bar";
import type { ActionRightTab } from "./right-panel/action-right-panel";
import type { PoseAxisWrite } from "./sequence-ops";
import type { SequenceSelection } from "./sequence-selection";
import type {
  ControlledObject as TimelineControlledObject,
  CueItem,
  ProgramNode,
} from "./timeline/timeline-data";

export type StaticPresetParams = {
  amplitude: number;
  phase: number;
};

/** 编辑坞形态：随内容库选中项变化 */
export type EditorDockMode = "cue" | "sequence" | "transition" | "empty";

export type TransitionDraft = {
  fromCueId: string;
  toCueId: string;
};

export type ProgramItemInput = { kind: "sequence"; refId: number };

export type ActionBuilderContextValue = {
  sequences: ActionSequenceConfig[];
  sequence: ActionSequenceConfig | null;
  selectedSequenceId: number | null;
  selection: SequenceSelection;
  selectedBlockId: string | null;
  selectedObjectIds: number[];
  cursorMs: number;
  activeRightTab: ActionRightTab;
  selectedProgramNodeId: string | null;
  contextSelection: ContextSelection | null;
  cues: CueItem[];
  programs: ProgramNode[];
  timelineObjects: TimelineControlledObject[];
  getTimelineObject: (objectId: number) => TimelineControlledObject | undefined;
  sequenceMissingHint: boolean;
  /** 编辑坞当前形态 */
  dockMode: EditorDockMode;
  selectedCueId: string | null;
  transitionDraft: TransitionDraft | null;
  /** 库内「组合过渡」两步选择的起点 Cue */
  combineFromCueId: string | null;
  /** 时间轴比例尺（像素/秒）；刻度间隔自适应；有 min/max */
  timelinePxPerSecond: number;
  canPasteBlock: boolean;
  setActiveRightTab: (tab: ActionRightTab) => void;
  handleSequenceSelect: (sequenceId: number | null) => void;
  handleSelectionChange: (selection: SequenceSelection) => void;
  handleObjectSelect: (objectId: number) => void;
  handleObjectsSelect: (objectIds: number[]) => void;
  handleCursorChange: (ms: number) => void;
  handleInsertTimelineBlock: (block: TimelineBlock) => boolean;
  handleReplaceTimelineBlock: (block: TimelineBlock) => boolean;
  handleApplyPoseAxisWrite: (blockIds: readonly string[], write: PoseAxisWrite) => boolean;
  handleMoveTimelineBlock: (blockId: string, atMs: number) => void;
  handleShiftTimelineBlocks: (blockIds: string[], deltaMs: number) => void;
  handleShiftTimelineBlocksEnd: () => void;
  handleResizeDynamicPreset: (blockId: string, startMs: number, endMs: number) => boolean;
  handleUpdateSegmentSettings: (
    fromRef: string,
    toRef: string,
    settings: MotionSegmentSettings,
  ) => void;
  handleBlockDelete: (blockIds?: string | string[]) => void;
  handleTrajectoryModeChange: (mode: TrajectoryMode) => void;
  handleBlockCopy: () => void;
  handleBlockPaste: () => void;
  handleTimelinePxPerSecondChange: (pxPerSecond: number) => void;
  handleTimelineZoomIn: () => void;
  handleTimelineZoomOut: () => void;
  handleCreatePose: (objectIds: number[]) => void;
  handleCreateSetEnabled: (objectIds: number[], enabled: boolean) => void;
  handleCreateCue: (objectIds: number[]) => void;
  handleCreateSequence: (objectIds: number[]) => void;
  handleApplyStaticPreset: (presetId: string, objectIds: number[], params: StaticPresetParams) => void;
  handleApplyDynamicPreset: (presetId: string, objectIds: number[]) => void;
  handleCuePreview: (cueId: string) => void;
  handleCueSelect: (cueId: string | null) => void;
  handleCueUpdate: (cueId: string, updates: Partial<Omit<CueItem, "id" | "targets">>) => void;
  handleCueTargetChange: (
    cueId: string,
    objectId: number,
    axis: VirtualAxisId,
    value: number,
  ) => void;
  handleCueAddObjects: (cueId: string, objectIds: number[]) => void;
  handleCueRemoveObject: (cueId: string, objectId: number) => void;
  handleCueDelete: (cueId: string) => void;
  handleCueCaptureFromScene: (cueId: string) => void;
  /** 两步组合：设置 / 取消起点 Cue */
  handleCombineStart: (cueId: string | null) => void;
  handleGenerateTransition: (fromCueId: string, toCueId: string) => void;
  handleTransitionSwap: () => void;
  handleTransitionCancel: () => void;
  handleTransitionSave: (durationMs: number) => void;
  handleCueDropOnTrack: (objectId: number, cueId: string, startMs: number) => void;
  handleProgramNodeSelect: (nodeId: string) => void;
  handleChapterAdd: () => void;
  handleProgramItemInsert: (chapterId: string, item: ProgramItemInput, index?: number) => void;
  handleProgramItemRemove: (chapterId: string, index: number) => void;
  handleProgramItemMove: (chapterId: string, fromIndex: number, toIndex: number) => void;
  handleSave: () => void;
  /** 最近一次非跟踪 motion 写回失败原因；成功后清空 */
  lastPersistError: string | null;
  /** 位姿拖拽松开 / 调参提交后刷新的序列校验（含电机叠加超速） */
  sequenceIssues: SequenceIssue[];
};
