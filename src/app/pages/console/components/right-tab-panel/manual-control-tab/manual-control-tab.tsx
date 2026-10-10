import { useProgram } from "../../../hooks/use-program";
import { ManualControlPanel } from "./manual-control-panel";

/** 控制页：保存当前位姿 = 新建动作序列并加入当前章节 */
export const ManualControlTab = () => {
  const { addCapturedPoseSequence, currentChapterId, isProgramEmpty, program } = useProgram();
  const captureChapterId =
    program.chapters.find((chapter) => chapter.id === currentChapterId)?.id ??
    program.chapters[0]?.id;

  return (
    <ManualControlPanel
      saveDisabled={isProgramEmpty || !captureChapterId}
      onSaveCurrentPose={addCapturedPoseSequence}
    />
  );
};
