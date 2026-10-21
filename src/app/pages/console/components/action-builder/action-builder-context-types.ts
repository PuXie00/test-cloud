import type { TrajectoryMode } from "@shared/action-sequence";
import type {
  ActionSequenceConfig,
  ModelPose,
  MotionSegmentSettings,
  TimelineBlock,
} from "@/app/project/action-sequence/types";
import type { SequenceIssue } from "@/app/project/action-sequence/validate-sequence";
import type { VirtualAxisId, VirtualAxisValues } from "@/app/project/project-document-types";
import type { CapturedPoseRequest } from "@/app/project/capture-pose-sequence";
import type { ContextSelection } from "./context-bar/selection-context-bar";
import type { PhaseInputMode } from "./motion-profile/phase-rates";
import type { CurveGraph, TimelineViewMode } from "./timeline/curve-data";
import type { ActionRightTab } from "./right-panel/action-right-panel";
import type { PoseAxisWrite, SegmentProfileWrite } from "./sequence-ops";
import type { SequenceSelection } from "./sequence-selection";
import type {
  ControlledObject as TimelineControlledObject,
  ProgramNode,
} from "./timeline/timeline-data";

/** 编辑坞形态：随动作序列库选中项变化 */
export type EditorDockMode = "sequence" | "empty";

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
  programs: ProgramNode[];
  timelineObjects: TimelineControlledObject[];
  getTimelineObject: (objectId: number) => TimelineControlledObject | undefined;
  sequenceMissingHint: boolean;
  /** 编辑坞当前形态 */
  dockMode: EditorDockMode;
  /** 时间轴比例尺（像素/秒）；刻度间隔自适应；有 min/max */
  timelinePxPerSecond: number;
  /** 剪贴板里有动作块（可来自别的序列或工程） */
  canPasteBlock: boolean;
  /** 剪贴板里有整条动作序列（可来自别的工程） */
  canPasteSequence: boolean;
  /** 运动区间阶段的填法（按时间 / 按速度），本次运行期间记住 */
  phaseInputMode: PhaseInputMode;
  handlePhaseInputModeChange: (mode: PhaseInputMode) => void;
  /** 时间轴看轨道还是曲线、曲线看哪根虚轴、看位置还是速度；离开动作页再回来也保持 */
  timelineViewMode: TimelineViewMode;
  handleTimelineViewModeChange: (mode: TimelineViewMode) => void;
  curveAxis: VirtualAxisId;
  handleCurveAxisChange: (axis: VirtualAxisId) => void;
  curveGraph: CurveGraph;
  handleCurveGraphChange: (graph: CurveGraph) => void;
  setActiveRightTab: (tab: ActionRightTab) => void;
  handleSequenceSelect: (sequenceId: number | null) => void;
  handleSelectionChange: (selection: SequenceSelection) => void;
  handleObjectSelect: (objectId: number) => void;
  handleObjectsSelect: (objectIds: number[]) => void;
  handleCursorChange: (ms: number) => void;
  handlePlaybackCursorChange: (ms: number) => void;
  handleInsertTimelineBlock: (block: TimelineBlock) => boolean;
  handleReplaceTimelineBlock: (block: TimelineBlock) => boolean;
  handleApplyPoseAxisWrite: (blockIds: readonly string[], write: PoseAxisWrite) => boolean;
  /** 取当前：把物体的实时位置写进这些位姿里设定了值的轴 */
  handleUpdatePosesFromLive: (
    blockIds: readonly string[],
    liveFor: (objectId: number) => VirtualAxisValues | null,
  ) => void;
  handleMoveTimelineBlock: (blockId: string, atMs: number) => void;
  handleShiftTimelineBlocks: (blockIds: string[], deltaMs: number) => void;
  handleShiftTimelineBlocksEnd: () => void;
  /** 曲线上拖位姿的值：这些位姿的这根轴都加 deltaValue（相对拖动开始） */
  handleDragPoseAxis: (blockIds: readonly string[], axis: VirtualAxisId, deltaValue: number) => void;
  handleDragPoseAxisEnd: () => void;
  handleResizeDynamicPreset: (blockId: string, startMs: number, endMs: number) => boolean;
  handleUpdateSegmentSettings: (
    fromRef: string,
    toRef: string,
    settings: MotionSegmentSettings,
  ) => void;
  /** 多选运动区间改阶段：一次写多段曲线 */
  handleWriteSegmentProfiles: (writes: readonly SegmentProfileWrite[]) => boolean;
  handleBlockDelete: (blockIds?: string | string[]) => void;
  /** 拆解预设：换成各物体的关键点位姿；不传时拆选中的预设 */
  handleExplodePresets: (blockIds?: readonly string[]) => void;
  /** 按当前坐标重排预设；不传角度沿用原方向，"auto" 重新取自动方向 */
  handleRelayoutPreset: (blockId: string, angleDeg?: number | "auto") => void;
  /** 在指定时刻（默认播放头）加标记并选中它，返回新标记的 id */
  handleAddMarker: (atMs?: number) => string | null;
  handleRenameMarker: (markerId: string, name: string) => boolean;
  handleSetMarkerTime: (markerId: string, atMs: number) => boolean;
  /** 拖标记：deltaMs 相对拖动开始；松手时调 handleShiftMarkersEnd */
  handleShiftMarkers: (markerIds: readonly string[], deltaMs: number) => void;
  handleShiftMarkersEnd: () => void;
  /** 不传时删选中的标记 */
  handleDeleteMarkers: (markerIds?: readonly string[]) => void;
  handleTrajectoryModeChange: (mode: TrajectoryMode) => void;
  handleLoopChange: (loop: boolean) => void;
  handleBlockCopy: () => void;
  handleBlockPaste: () => void;
  handleSequenceCopy: (sequenceId: number) => void;
  handleSequencePaste: () => void;
  handleTimelinePxPerSecondChange: (pxPerSecond: number) => void;
  handleTimelineZoomIn: () => void;
  handleTimelineZoomOut: () => void;
  handleCreatePose: (objectIds: number[]) => void;
  handleCreateSetEnabled: (objectIds: number[], enabled: boolean) => void;
  handleCreateSequence: (objectIds: number[]) => void;
  /** 保存当前位姿：有选中序列则在播放头加位姿，否则新建序列（不加入节目） */
  handleSaveCurrentPose: (request: CapturedPoseRequest) => void;
  /** 物体的实时位姿（虚轴1–3），拿不到时为 null；调用时读取，不随遥测重渲染 */
  getLivePose: (objectId: number) => ModelPose | null;
  /** 返回错误文案；成功或名称未变化时返回 null */
  /** 不传 sequenceId 时重命名选中的序列 */
  handleRenameSequence: (name: string, sequenceId?: number) => string | null;
  handleDeleteSequence: () => void;
  handleApplyStaticPreset: (presetId: string, objectIds: number[]) => void;
  handleApplyDynamicPreset: (presetId: string, objectIds: number[]) => void;
  handleProgramNodeSelect: (nodeId: string) => void;
  handleChapterAdd: () => void;
  handleProgramItemInsert: (chapterId: string, item: ProgramItemInput, index?: number) => void;
  handleProgramItemRemove: (chapterId: string, index: number) => void;
  handleProgramItemMove: (chapterId: string, fromIndex: number, toIndex: number) => void;
  handleSave: () => void;
  /** 最近一次非跟踪 motion 写回失败原因；成功后清空 */
  lastPersistError: string | null;
  /** 位姿拖拽松开 / 调参提交后刷新的序列校验（含电机叠加超速、角度保护） */
  sequenceIssues: SequenceIssue[];
};
