import {
  getSequenceTransport,
  isPlcRejection,
  type SequenceExecutionTransport,
  type SequenceRuntimeHandle,
} from "./sequence-execution";

export type SpeedTarget = {
  sequenceHandle?: SequenceRuntimeHandle;
  trajectoryMode?: boolean;
  reverse?: boolean;
};

/** 运行中调速：强制轨迹按 actionSpeedScale 下发新的倍率，非强制只改本地显示 */
export const adjustSequenceSpeed = async (
  card: SpeedTarget,
  speedPercent: number,
  transport: SequenceExecutionTransport = getSequenceTransport(),
): Promise<void> => {
  const handle = card.sequenceHandle;
  if (!handle || card.trajectoryMode !== true || !transport.setSpeed) return;
  await transport.setSpeed({
    actionId: handle.actionId,
    speedScale: speedPercent / 100,
    runDirection: card.reverse === true ? 2 : 1,
    loopCount: handle.loopCount ?? 1,
    deviceId: handle.deviceId ?? [],
  });
};

/**
 * 拖动滑条时连续调速：同一个动作同时只发一条，发送期间的改动只留最后一次，应答后再补发。
 * PLC 拒绝时回调 onRejected；没连上 PLC 时按本地调速处理。
 */
export const createSpeedSender = (
  onRejected: (message: string) => void,
  transportOf: () => SequenceExecutionTransport = getSequenceTransport,
) => {
  const pendingByAction = new Map<number, { card: SpeedTarget; speedPercent: number } | null>();
  const send = (card: SpeedTarget, speedPercent: number): void => {
    const actionId = card.sequenceHandle?.actionId;
    if (actionId === undefined) return;
    if (pendingByAction.has(actionId)) {
      pendingByAction.set(actionId, { card, speedPercent });
      return;
    }
    pendingByAction.set(actionId, null);
    void adjustSequenceSpeed(card, speedPercent, transportOf())
      .catch((error: unknown) => {
        if (isPlcRejection(error)) {
          onRejected(`调速失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => {
        const next = pendingByAction.get(actionId);
        pendingByAction.delete(actionId);
        if (next) send(next.card, next.speedPercent);
      });
  };
  return send;
};
