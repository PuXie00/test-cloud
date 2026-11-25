import { toast } from "sonner";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import { sequenceShape } from "@/app/project/action-sequence/sequence-shape";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { positionsToAxisValues, type GoReadyEntry } from "../../hooks/go-ready";
import { useOptionalGoReady } from "../../hooks/go-ready-provider";
import { useOptionalControlledObjects } from "../../hooks/use-controlled-objects";
import { useActionBuilder } from "./use-action-builder";

/**
 * 序列库「去这里」：把这条序列的起点（每个物体自己的第一个设定值）设成 GO 目标，
 * 打开「当前位置」。不打开这条序列，正在编的序列不受影响；按 GO 才动。
 * 没有 GO 或设备数据（单独渲染序列库时）为 null。
 */
export const useGoToSequence = (): ((sequence: ActionSequenceConfig) => void) | null => {
  const goReady = useOptionalGoReady();
  const controlled = useOptionalControlledObjects();
  const { setLiveMode, handleSelectionChange } = useActionBuilder();
  if (!goReady || !controlled) return null;
  const { setTargets } = goReady;
  const { getById } = controlled;

  return (sequence: ActionSequenceConfig) => {
    let shape: ReturnType<typeof sequenceShape>;
    try {
      shape = sequenceShape(resolveActionSequence(sequence), "start");
    } catch {
      toast.warning(`「${sequence.name}」有待修复的内容，去不了`);
      return;
    }
    const entries: GoReadyEntry[] = [];
    let offline = 0;
    for (const [objectId, pose] of shape) {
      const current = positionsToAxisValues(getById(objectId)?.positions ?? null);
      if (Object.keys(current).length === 0) {
        offline += 1;
        continue;
      }
      entries.push({
        objectId: String(objectId),
        target: { ...pose },
        current,
        source: { kind: "sequence", name: sequence.name },
      });
    }
    // 选着的位姿也是 GO 目标：先取消选中，免得和这条序列的目标混在一起
    handleSelectionChange(null);
    setLiveMode(true);
    if (entries.length === 0) {
      toast.warning(`「${sequence.name}」里的物体都不在线`);
      return;
    }
    setTargets(entries);
    if (offline > 0) toast.info(`${offline} 个物体不在线，已跳过`);
  };
};
