import type { ControlType } from "@/app/project/configuration-types";
import oneMoveGif from "@/assets/prompt/one-move.gif";
import oneRotateGif from "@/assets/prompt/one-rotate.gif";
import oneUpdownGif from "@/assets/prompt/one-updowm.gif";
import orbitGif from "@/assets/prompt/orbit.gif";
import fourSwingGif from "@/assets/prompt/four-swing.gif";
import multiSwingGif from "@/assets/prompt/multi-swing.gif";

/** 控制类型的示意动画；单点旋转和无控制暂无 */
export const CONTROL_TYPE_PROMPT_GIF: Partial<Record<ControlType, string>> = {
  singlePointMove: oneMoveGif,
  continuousRotation: oneRotateGif,
  multiLevelHoist: oneUpdownGif,
  railCar: orbitGif,
  dualTiltFourPointSwing: fourSwingGif,
  multiPointSwing: multiSwingGif,
};
