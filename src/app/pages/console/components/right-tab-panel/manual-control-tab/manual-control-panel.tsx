import { Link2 } from "lucide-react";
import type { CapturedPoseRequest } from "@/app/project/capture-pose-sequence";
import {
  sendAllStopPlc,
  sendEnableModel,
  sendHomeModel,
  sendResetModel,
  sendStopModel,
} from "../../../hooks/manual-commands";
import { useProjectStore } from "../../../hooks/use-project-store";
import { useSelection } from "../../../hooks/use-selection";
import { useSequencePreview } from "../../../hooks/use-sequence-preview";
import { useProject } from "@/app/project/use-project";
import { usePermissions } from "@/app/auth/permissions";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useCoupleFlow } from "../../../hooks/use-couple-flow";
import { StatusControlBar } from "./status-control-bar";
import { CouplePreviewDialog } from "./couple-preview-dialog";
import { JogControl } from "./jog-control";
import { DimensionControl } from "./dimension-control";
import { QuickActions } from "./quick-actions";
import { poseFromControlSnapshot } from "./pose-from-control-snapshot";
import { unionDimensions } from "./shared-dimensions";
import { resolveManualControlAvailability } from "./manual-control-availability";
import { resolveObjectStatusLabel } from "../../monitor-grid/object-status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";

type ManualControlPanelProps = {
  /** 页面条件不满足时禁用保存（未选物体时总是禁用） */
  saveDisabled?: boolean;
  /** 保存到哪里由页面决定 */
  onSaveCurrentPose: (request: CapturedPoseRequest) => void;
  /** 操作这些物体，不跟随全局选择（动作页联机编辑选中的位姿） */
  objectIds?: readonly number[];
  /** 保存按钮的文字，默认「保存当前位姿」 */
  saveLabel?: string;
  /** 不能保存的原因，显示在保存按钮下 */
  saveBlockedReason?: string | null;
  /** 顶部的联机说明 */
  liveLabel?: string | null;
};

/** 手动控制：状态条 / 点动 / 维度控制 / 快捷操作；控制页与动作页共用 */
export const ManualControlPanel = ({
  saveDisabled = false,
  onSaveCurrentPose,
  objectIds,
  saveLabel,
  saveBlockedReason = null,
  liveLabel = null,
}: ManualControlPanelProps) => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { plcs } = useProjectStore();
  const { getById } = useControlledObjects();
  const { sequenceId: previewSequenceId } = useSequencePreview();
  const { currentProject } = useProject();
  // 点动、维度控制 / GO 要「手动运动」；取当前写进位姿要「编辑动作序列」；状态条按钮各自判断
  const { can } = usePermissions();
  const canMove = can("control.manual");
  const canWritePose = can("action.edit");
  // 预览中：手动操作不可用，头部提示
  const previewing = previewSequenceId !== null;
  const previewName = previewing
    ? currentProject?.document?.motion.actionSequences.find((sequence) => sequence.id === previewSequenceId)
        ?.name
    : undefined;

  const selectedIds =
    objectIds ??
    (multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : []);
  const snapshots = selectedIds.flatMap((id) => {
    const snapshot = getById(id);
    return snapshot ? [snapshot] : [];
  });
  const couple = useCoupleFlow(selectedIds);
  // 未选物体、或任一所选物体状态不满足（如离线）时禁用对应操作
  const availability = resolveManualControlAvailability(
    snapshots.map((snapshot) => ({
      name: snapshot.descriptor.name,
      status: snapshot.descriptor.status,
    })),
    previewing ? { name: previewName } : null,
  );
  const canSave = !saveDisabled && !saveBlockedReason && availability.allowed("savePose");

  const handleSaveCurrentPose = () => {
    onSaveCurrentPose({
      objectIds: selectedIds,
      poseForObject: (objectId) => {
        const snapshot = getById(objectId);
        if (!snapshot) return null;
        return poseFromControlSnapshot(snapshot);
      },
    });
  };

  const primary = snapshots[0];
  const dimensions = unionDimensions(snapshots.map((snapshot) => snapshot.descriptor.dimensions));
  const statusKeys = [...new Set(snapshots.map((snapshot) => snapshot.descriptor.status))];
  const statusLabels = [
    ...new Set(
      snapshots.map((snapshot) =>
        resolveObjectStatusLabel(snapshot.descriptor.status, snapshot.modelStatus),
      ),
    ),
  ];
  const objectLabel = !primary
    ? null
    : snapshots.length === 1
      ? primary.descriptor.name
      : `${primary.descriptor.name} +${snapshots.length - 1}`;
  const objectSummary = !primary
    ? ""
    : snapshots.length === 1
      ? `将对「${primary.descriptor.name}」执行此操作。`
      : `将对「${primary.descriptor.name}」等 ${snapshots.length} 个受控物体执行此操作。`;

  const handleCoupleChoice = (coupleFlag: 0 | 1) => {
    if (coupleFlag === 0) {
      couple.handleDecouple();
      return;
    }
    void couple.handleCouple();
  };

  const deviceIds = snapshots.map((snapshot) => snapshot.descriptor.id);

  const handleEnableChoice = (enableFlag: 0 | 1) => {
    void sendEnableModel(deviceIds, enableFlag);
  };

  const handleReset = () => {
    void sendResetModel(deviceIds);
  };

  const handleHome = () => {
    void sendHomeModel(deviceIds);
  };

  const handleStop = () => {
    void sendStopModel(deviceIds);
  };

  const handleAllStop = () => {
    void sendAllStopPlc(plcs.map((plc) => plc.id));
  };

  return (
    <div className="custom-scrollbar h-full overflow-y-auto bg-card-muted">
      {liveLabel ? (
        <div className="px-3 pt-3">
          <div
            role="status"
            className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-body-sm font-semibold text-primary"
          >
            <Link2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{liveLabel}</span>
          </div>
          <p className="mt-1 px-1 text-body-sm text-muted-foreground">
            位姿已设为 GO 目标；点动或改目标到位后按「取当前」写回
          </p>
        </div>
      ) : null}
      <StatusControlBar
        objectLabel={objectLabel}
        objectSummary={objectSummary}
        batchNames={snapshots.map((snapshot) => snapshot.descriptor.name)}
        status={statusLabels.join(" / ")}
        objectStatus={statusKeys.length === 1 ? (statusKeys[0] ?? "offline") : "offline"}
        notice={primary || previewing ? availability.notice : null}
        allowed={availability.allowed}
        coupleBusy={couple.busy}
        onCoupleChoice={handleCoupleChoice}
        onEnableChoice={handleEnableChoice}
        onReset={handleReset}
        onHome={handleHome}
        onStop={handleStop}
        onAllStop={handleAllStop}
      />
      {canMove && (
        <>
          <JogControl
            objectIds={selectedIds}
            dimensions={dimensions}
            disabled={!availability.allowed("jog")}
            settingsDisabled={!availability.allowed("jogSettings")}
          />
          <DimensionControl objectIds={selectedIds} disabled={!availability.allowed("dimension")} />
        </>
      )}
      {canWritePose && (
        <QuickActions
          canSave={canSave}
          onSave={handleSaveCurrentPose}
          label={saveLabel}
          hint={saveBlockedReason}
        />
      )}
      <AlertDialog open={couple.phase === "solving"}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>正在计算耦合姿态…</AlertDialogTitle>
            <AlertDialogDescription>请等待反解完成，不要重复点击。</AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
      <CouplePreviewDialog
        open={couple.phase === "preview"}
        preview={couple.preview}
        onCancel={couple.reset}
        onConfirm={couple.handleConfirmPreview}
      />
      <AlertDialog open={couple.phase === "error"} onOpenChange={(open) => { if (!open) couple.reset(); }}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>耦合失败</AlertDialogTitle>
            <AlertDialogDescription>{couple.errorMessage || "未知错误"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={couple.reset}>关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
