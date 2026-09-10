import { createContext, useContext } from "react";
import type { ChapterItem, Program } from "../components/program-panel/program-data";

export type PageItems = {
  cues: ChapterItem[];
  sequences: ChapterItem[];
};

export type ProgramContextValue = {
  program: Program;
  currentChapterId: string;
  currentPageIndex: number;
  totalPages: number;
  pageItems: PageItems;
  setCurrentChapter: (chapterId: string) => void;
  nextPage: () => void;
  prevPage: () => void;
  addChapter: () => void;
  removeChapter: (chapterId: string) => void;
  renameChapter: (chapterId: string, name: string) => void;
  reorderItemInChapter: (chapterId: string, fromIndex: number, toIndex: number) => void;
  moveItemAcrossChapter: (
    fromChapterId: string,
    fromIndex: number,
    toChapterId: string,
    toIndex: number,
  ) => void;
  addCue: (chapterId: string) => void;
  addSequence: (chapterId: string) => void;
  removeItem: (chapterId: string, index: number) => void;
  /** 工程尚无节目/章节，控制界面应显示编排指引 */
  isProgramEmpty: boolean;
  /** 最近一次非跟踪 program 写回失败原因；成功后清空 */
  lastPersistError: string | null;
};

export const ProgramContext = createContext<ProgramContextValue | null>(null);

export const useProgram = (): ProgramContextValue => {
  const value = useContext(ProgramContext);
  if (!value) throw new Error("useProgram must be used inside ProgramProvider");
  return value;
};
