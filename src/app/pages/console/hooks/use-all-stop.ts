import { useCallback } from "react";
import { usePlcRuntime } from "./plc-runtime-provider";
import { useExecCardActions } from "./use-exec-cards";
import { useExecutorSlotActions } from "./use-executor-slots";

/** 总停止：先停任务卡上的动作再下发 AllStop；成功后清掉任务卡，推子槽全部回到未准备 */
export const useAllStop = (): (() => void) => {
  const { emergencyStopAll, clearAll } = useExecCardActions();
  const { resetAllSlots } = useExecutorSlotActions();
  const { allStopAll } = usePlcRuntime();

  return useCallback(() => {
    emergencyStopAll();
    void allStopAll().then((stopped) => {
      if (!stopped) return;
      clearAll();
      resetAllSlots();
    });
  }, [emergencyStopAll, allStopAll, clearAll, resetAllSlots]);
};
