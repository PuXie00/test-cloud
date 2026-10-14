import type { LogWriteParams } from "@shared/csocket/operation-log";

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

/** 配置操作（保存工程等）及其结果 */
export const writeConfigOperationLog = (opType: string, message: string, error?: unknown): void =>
  writeOperationLog({
    category: "operation",
    level: error === undefined ? "info" : "warning",
    opGroup: "config",
    opType,
    message,
    result:
      error === undefined
        ? { ok: true }
        : { ok: false, message: error instanceof Error ? error.message : String(error) },
  });
