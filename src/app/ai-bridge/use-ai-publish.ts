import { useEffect, useRef } from "react";
import type { AiRendererMessage } from "@shared/ai-bridge/types";

export const publishAiMessage = (message: AiRendererMessage): void => {
  window.aiBridgeApi?.publish(message);
};

/**
 * key 变化后 delayMs 内不再变化才发布，合并连续变化；build 只在真正发布时调用，
 * 重的序列化（如整份工程配置）不会跟着每次渲染跑。
 */
export const useAiPublish = (
  key: string,
  build: () => AiRendererMessage,
  delayMs: number,
): void => {
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const timer = window.setTimeout(() => publishAiMessage(buildRef.current()), delayMs);
    return () => window.clearTimeout(timer);
  }, [key, delayMs]);
};
