import { createContext } from "react";
import type { ActionBuilderContextValue } from "./action-builder-context-types";

/** 独立模块持有 context 实例，避免 HMR / 分包导致 Provider 与 hook 引用不一致 */
export const ActionBuilderContext = createContext<ActionBuilderContextValue | null>(null);
