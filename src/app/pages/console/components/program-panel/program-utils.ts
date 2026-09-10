import type { ProjectDocument } from "@/app/project/project-document-types";
import type { Program } from "./program-data";

/** 控制界面是否尚无可用节目结构（无节目或无章节） */
export const isControlProgramEmpty = (
  document: ProjectDocument | undefined,
  program: Program,
): boolean => {
  if (!document) return false;
  if (document.motion.programs.length === 0) return true;
  return program.chapters.length === 0;
};
