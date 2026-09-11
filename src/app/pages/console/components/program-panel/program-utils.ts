import type { ProjectDocument } from "@/app/project/project-document-types";
import { PROGRAM_SLOTS_PER_PAGE, type ChapterItem, type Program } from "./program-data";

export const sliceProgramPage = (items: ChapterItem[], pageIndex: number): ChapterItem[] => {
  const start = pageIndex * PROGRAM_SLOTS_PER_PAGE;
  return items.slice(start, start + PROGRAM_SLOTS_PER_PAGE);
};

export const programPageCount = (items: ChapterItem[]): number =>
  Math.max(1, Math.ceil(items.length / PROGRAM_SLOTS_PER_PAGE));

/** 控制界面是否尚无可用节目结构（无节目或无章节） */
export const isControlProgramEmpty = (
  document: ProjectDocument | undefined,
  program: Program,
): boolean => {
  if (!document) return false;
  if (document.motion.programs.length === 0) return true;
  return program.chapters.length === 0;
};
