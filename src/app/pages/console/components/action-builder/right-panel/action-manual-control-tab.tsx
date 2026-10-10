import { ManualControlPanel } from "../../right-tab-panel/manual-control-tab/manual-control-panel";
import { useActionBuilder } from "../use-action-builder";

/** 动作页：保存当前位姿 = 往选中序列的播放头加位姿，未选序列则新建序列（不加入节目） */
export const ActionManualControlTab = () => {
  const { handleSaveCurrentPose } = useActionBuilder();
  return <ManualControlPanel onSaveCurrentPose={handleSaveCurrentPose} />;
};
