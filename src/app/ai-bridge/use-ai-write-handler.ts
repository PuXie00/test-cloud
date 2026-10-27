import { useEffect, useRef } from "react";
import type { AiWriteRequest, AiWriteResult } from "@shared/ai-bridge/types";
import { usePermissions } from "@/app/auth/permissions";
import { useProject } from "@/app/project/use-project";
import { planAiSequenceUpsert, type AiSequenceUpsertPlan } from "./ai-sequence-upsert";

/** 处理本地 AI 的写入请求：在最新文档上校验，通过才作为未保存修改写入工程 */
export const useAiWriteHandler = (): void => {
  const { currentProject, updateCurrentDocument } = useProject();
  // AI 以当前登录用户的身份写：要有「编辑动作序列」，没人登录也不行
  const canEdit = usePermissions().can("action.edit");
  const latestRef = useRef({ currentProject, updateCurrentDocument, canEdit });
  latestRef.current = { currentProject, updateCurrentDocument, canEdit };

  useEffect(() => {
    const handle = (request: AiWriteRequest): AiWriteResult => {
      if (request?.kind !== "upsert-sequence") {
        return { ok: false, code: "INVALID_SEQUENCE", message: "unknown write request" };
      }
      const { currentProject: project, updateCurrentDocument: update, canEdit: allowed } = latestRef.current;
      if (!allowed) {
        return { ok: false, code: "FORBIDDEN", message: "当前登录用户没有「编辑动作序列」权限" };
      }
      if (!project?.document) {
        return { ok: false, code: "NO_PROJECT", message: "没有打开的工程" };
      }
      // 在 updater 里拿到的才是提交时的最新文档
      let plan = null as AiSequenceUpsertPlan | null;
      const outcome = update((document) => {
        plan = planAiSequenceUpsert(document, request.sequence);
        return plan.document ?? document;
      }, "ai");
      if (!plan) {
        return { ok: false, code: "BUSY", message: outcome.ok ? "工程暂不可修改" : outcome.reason };
      }
      if (!outcome.ok && plan.result.ok) {
        return { ok: false, code: "VALIDATION_FAILED", message: outcome.reason };
      }
      return plan.result;
    };
    return window.aiBridgeApi?.onWriteRequest(handle);
  }, []);
};
