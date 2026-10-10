import { useMemo } from "react";
import { useLocation } from "react-router";
import { AI_CONFIG_PUBLISH_MS, AI_VIEW_PUBLISH_MS } from "@shared/ai-bridge/protocol";
import type { AiPageView } from "@shared/ai-bridge/types";
import { toDocumentLike } from "@/app/project/project-ipc";
import { useProject } from "@/app/project/use-project";
import { buildAiEntityNames, resolveAiPage } from "./ai-view";
import { useAiPublish } from "./use-ai-publish";

/** 给每个文档对象一个序号：文档不可变更新，对象变了就是内容变了 */
const documentIds = new WeakMap<object, number>();
let nextDocumentId = 1;
const documentKey = (document: object): number => {
  let id = documentIds.get(document);
  if (id === undefined) {
    id = nextDocumentId++;
    documentIds.set(document, id);
  }
  return id;
};

/** 应用级：把所在页面、当前工程和工程配置（含未保存修改）推给本地 AI 服务 */
export const AiAppSync = () => {
  const { pathname } = useLocation();
  const { currentProject, isDirty, documentRevision } = useProject();

  const projectId = currentProject?.id;
  const projectName = currentProject?.name;
  const folderName = currentProject?.folderName;
  const pageView = useMemo<AiPageView>(
    () => ({
      ...resolveAiPage(pathname),
      path: pathname,
      project:
        projectId !== undefined && projectName !== undefined && folderName !== undefined
          ? { id: projectId, name: projectName, folderName, dirty: isDirty }
          : null,
    }),
    [pathname, projectId, projectName, folderName, isDirty],
  );
  const pageKey = useMemo(() => JSON.stringify(pageView), [pageView]);
  useAiPublish(pageKey, () => ({ type: "page", data: pageView }), AI_VIEW_PUBLISH_MS);

  const document = currentProject?.document;
  const configKey = document ? `${documentKey(document)}:${isDirty}` : "none";
  useAiPublish(
    configKey,
    () => ({
      type: "config",
      data: document
        ? {
            revision: documentRevision.value,
            dirty: isDirty,
            document: toDocumentLike(document),
            names: buildAiEntityNames(document),
          }
        : null,
    }),
    AI_CONFIG_PUBLISH_MS,
  );

  return null;
};
