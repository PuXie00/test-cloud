import { sendEnableModel, sendHomeModel, sendResetModel } from "../../../hooks/manual-commands";
import { useSelection } from "../../../hooks/use-selection";
import { useControlledObjects } from "../../../hooks/use-controlled-objects";
import { useCoupleFlow } from "../../../hooks/use-couple-flow";
import { useProgram } from "../../../hooks/use-program";
import { StatusControlBar } from "./status-control-bar";
import { CouplePreviewDialog } from "./couple-preview-dialog";
import { JogControl } from "./jog-control";
import { DimensionControl } from "./dimension-control";
import { QuickActions } from "./quick-actions";
import { sharedDimensions } from "./shared-dimensions";
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

export const ManualControlTab = () => {
  const { selectedId, multiSelectedIds } = useSelection();
  const { getById } = useControlledObjects();

  const selectedIds =
    multiSelectedIds.length > 0 ? multiSelectedIds : selectedId != null ? [selectedId] : [];
  const snapshots = selectedIds.flatMap((id) => {
    const snapshot = getById(id);
    return snapshot ? [snapshot] : [];
  });
  const couple = useCoupleFlow(selectedIds);
  const { addCapturedPoseSequence, currentChapterId, isProgramEmpty } = useProgram();
  const canSave = !isProgramEmpty && Boolean(currentChapterId) && selectedIds.length > 0;

  const handleSaveCurrentPose = () => {
    addCapturedPoseSequence({
      objectIds: selectedIds,
      poseForObject: (objectId) => {
        const snapshot = getById(objectId);
        if (!snapshot) return null;
        return { v1: snapshot.values.v1 ?? 0, v2: 0, v3: 0 };
      },
    });
  };

  if (snapshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-body-sm text-muted-foreground">
        请在监控网格或 3D 视图中选择受控物体
      </div>
    );
  }

  const primary = snapshots[0];
  const dimensions = sharedDimensions(snapshots.map((snapshot) => snapshot.descriptor.dimensions));
  const statusKeys = [...new Set(snapshots.map((snapshot) => snapshot.descriptor.status))];
  const statusLabels = [
    ...new Set(
      snapshots.map((snapshot) =>
        resolveObjectStatusLabel(snapshot.descriptor.status, snapshot.modelStatus),
      ),
    ),
  ];
  const objectLabel =
    snapshots.length === 1 ? primary.descriptor.name : `${primary.descriptor.name} +${snapshots.length - 1}`;
  const objectSummary =
    snapshots.length === 1
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

  return (
    <div className="custom-scrollbar h-full overflow-y-auto bg-card-muted">
      <StatusControlBar
        objectLabel={objectLabel}
        objectSummary={objectSummary}
        status={statusLabels.join(" / ")}
        objectStatus={statusKeys.length === 1 ? (statusKeys[0] ?? "offline") : "offline"}
        coupleBusy={couple.busy}
        onCoupleChoice={handleCoupleChoice}
        onEnableChoice={handleEnableChoice}
        onReset={handleReset}
        onHome={handleHome}
      />
      <JogControl dimensions={dimensions} />
      <DimensionControl dimensions={dimensions} />
      <QuickActions canSave={canSave} onSave={handleSaveCurrentPose} />
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
