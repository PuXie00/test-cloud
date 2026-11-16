import { PROJECT_FORMAT_VERSION } from "@shared/project/project-format";
import type { ProjectRecord } from "./project-types";

type CompatFields = Pick<ProjectRecord, "compat" | "formatVersion">;

/** 版本过高、读不了的工程不能打开（也就不能另存为） */
export const canOpenProject = (project: CompatFields): boolean =>
  project.compat !== "too-new" && project.compat !== "invalid";

/** 工程卡片角标；能直接打开的当前格式工程不显示 */
export const projectCompatBadge = (
  project: CompatFields,
): { label: string; className: string } | null => {
  switch (project.compat) {
    case "upgrade":
      return { label: "旧格式", className: "bg-muted text-muted-foreground" };
    case "too-new":
      return { label: "版本过高", className: "bg-warning-surface text-warning" };
    case "invalid":
      return { label: "无法读取", className: "bg-destructive/15 text-destructive" };
    default:
      return null;
  }
};

/** 详情里的格式版本：没给（测试数据）当作当前版本，读不出来显示未知 */
export const formatVersionLabel = (project: CompatFields): string => {
  if (project.formatVersion === undefined) return `v${PROJECT_FORMAT_VERSION}`;
  return project.formatVersion === null ? "未知" : `v${project.formatVersion}`;
};
