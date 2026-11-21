import { ManualControlPanel } from "../../right-tab-panel/manual-control-tab/manual-control-panel";
import { useActionBuilder } from "../use-action-builder";
import { useLiveCapture } from "./live-edit";

/**
 * 动作页手动控制：联机编辑时点动、维度控制和「取当前」。
 * - 选中的位姿是 GO 目标（由 LivePoseGoBinding 绑定，「当前位置」开着时在哪个页签都一样），手动控制操作这些位姿的物体
 * - 「取当前」把实时位置写进选中位姿；没选位姿时写到播放头，没选序列则新建序列（不加入节目）
 */
export const ActionManualControlTab = () => {
  const { handleSelectionChange, handleSaveShape } = useActionBuilder();
  const { live, poses, saveLabel, saveBlockedReason, liveLabel, save } = useLiveCapture();

  return (
    <ManualControlPanel
      objectIds={live.kind === "poses" ? poses.map((block) => block.objectId) : undefined}
      liveLabel={liveLabel}
      saveLabel={saveLabel}
      saveBlockedReason={saveBlockedReason}
      onSaveCurrentPose={save}
      // 选着位姿时「清除」连选中的位姿一起清掉，手动控制回到操作选中的物体
      onClearTargets={live.kind === "none" ? undefined : () => handleSelectionChange(null)}
      onSaveShape={handleSaveShape}
    />
  );
};
