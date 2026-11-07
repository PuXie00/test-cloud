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
  /** 当前速度（百分比），调速前的值 */
  speedPercent: number;
};

/** 运行中调速：强制轨迹走 1006，非强制走 syncAdjustSpeed；prvSpeedPercent 为 PLC 上次已生效的速度 */
export const adjustSequenceSpeed = async (
  card: SpeedTarget,
  speedPercent: number,
  transport: SequenceExecutionTransport = getSequenceTransport(),
  prvSpeedPercent: number = card.speedPercent,
): Promise<void> => {
  const handle = card.sequenceHandle;
  if (!handle || !transport.setSpeed) return;
  await transport.setSpeed({
    actionId: handle.actionId,
    trajectoryMode: card.trajectoryMode === true,
    prvSpeedScale: prvSpeedPercent / 100,
    speedScale: speedPercent / 100,
    runDirection: card.reverse === true ? 2 : 1,
    loopCount: handle.loopCount ?? 1,
    deviceId: handle.deviceId ?? [],
  });
};

type SpeedRequest = { card: SpeedTarget; speedPercent: number };

/**
 * 拖动滑条时连续调速：同一个动作同时只发一条，发送期间的改动只留最后一次，应答后再补发。
 * 补发时的上次速度取 PLC 已生效的那次；PLC 拒绝时回调 onRejected 并保留原速度；没连上 PLC 时按本地调速处理。
 */
export const createSpeedSender = (
  onRejected: (message: string) => void,
  transportOf: () => SequenceExecutionTransport = getSequenceTransport,
) => {
  const pendingByAction = new Map<number, SpeedRequest | null>();

  const dispatch = (actionId: number, request: SpeedRequest, prvSpeedPercent: number): void => {
    pendingByAction.set(actionId, null);
    void adjustSequenceSpeed(request.card, request.speedPercent, transportOf(), prvSpeedPercent)
      .then(
        () => request.speedPercent,
        (error: unknown) => {
          if (!isPlcRejection(error)) return request.speedPercent;
          onRejected(`调速失败：${error instanceof Error ? error.message : String(error)}`);
          return prvSpeedPercent;
        },
      )
      .then((appliedPercent) => {
        const next = pendingByAction.get(actionId);
        pendingByAction.delete(actionId);
        if (next) dispatch(actionId, next, appliedPercent);
      });
  };

  const send = (card: SpeedTarget, speedPercent: number): void => {
    const actionId = card.sequenceHandle?.actionId;
    if (actionId === undefined) return;
    if (pendingByAction.has(actionId)) {
      pendingByAction.set(actionId, { card, speedPercent });
      return;
    }
    dispatch(actionId, { card, speedPercent }, card.speedPercent);
  };
  return send;
};
