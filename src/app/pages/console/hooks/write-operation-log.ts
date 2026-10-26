import { LOG_RESULT, type LogWriteParams } from "@shared/csocket/operation-log";

/** 界面侧事件交给 C++ 写入当前工程日志；失败只打印，不影响业务 */
export const writeOperationLog = (entry: LogWriteParams): void => {
  const api = typeof window !== "undefined" ? window.csocketApi : undefined;
  if (!api?.logWrite) return;
  void api
    .logWrite([{ timestamp: Date.now(), ...entry }])
    .then((ack) => {
      if (!ack?.success) console.warn("[log] logWrite failed", ack?.message);
    })
    .catch((err) => console.warn("[log] logWrite failed", err));
};

/** 配置操作（保存工程等）的结果，记为操作回码；库里没有失败原因字段，原因拼进文案 */
export const writeConfigOperationLog = (opType: string, message: string, error?: unknown): void =>
  writeOperationLog({
    category: "optRet",
    level: error === undefined ? "info" : "warning",
    opGroup: "config",
    opType,
    message:
      error === undefined ? message : `${message}：${error instanceof Error ? error.message : String(error)}`,
    result: error === undefined ? LOG_RESULT.ok : LOG_RESULT.failed,
  });
