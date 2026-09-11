import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { allocateSequenceIdsInProject } from "@/app/project/action-sequence/sequence-id";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { ProjectDocument, ProjectMotion } from "@/app/project/project-document-types";
import { legacyProgramToMotion } from "@/app/project/motion-persist";
import { useProject } from "@/app/project/use-project";
import { motionProgramToLegacyProgram } from "../components/program-panel/resolve-program-motion";
import { isControlProgramEmpty, programPageCount, sliceProgramPage } from "../components/program-panel/program-utils";
import { type Program } from "../components/program-panel/program-data";
import { ProgramContext, type ProgramContextValue } from "./program-context";

export type { PageItems } from "./program-context";
export { useProgram } from "./program-context";

type ProgramProviderProps = { children: ReactNode };

const buildEmptyProgram = (document: ProjectDocument): Program => ({
  id: "prog-empty",
  name: document.meta.name,
  note: undefined,
  chapters: [],
});

const resolveProgramFromDocument = (
  document: ProjectDocument | undefined,
): Program => {
  if (!document) return { id: "prog-empty", name: "", chapters: [] };
  return motionProgramToLegacyProgram(document.motion) ?? buildEmptyProgram(document);
};

export const ProgramProvider = ({ children }: ProgramProviderProps) => {
  const { currentProject, updateCurrentDocument, documentRevision } = useProject();
  const [program, setProgram] = useState<Program>(() =>
    resolveProgramFromDocument(currentProject?.document),
  );
  const [currentChapterId, setCurrentChapterId] = useState<string>(
    () => resolveProgramFromDocument(currentProject?.document).chapters[0]?.id ?? "",
  );
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [lastPersistError, setLastPersistError] = useState<string | null>(null);

  const programRef = useRef(program);
  programRef.current = program;
  const currentChapterIdRef = useRef(currentChapterId);
  currentChapterIdRef.current = currentChapterId;
  const currentPageIndexRef = useRef(currentPageIndex);
  currentPageIndexRef.current = currentPageIndex;
  const hydratingRef = useRef(false);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const hydratedMotionRef = useRef<ProjectMotion | null>(null);

  useEffect(() => {
    if (!currentProject?.document) {
      if (hydratedProjectIdRef.current !== null) {
        hydratedProjectIdRef.current = null;
        hydratedMotionRef.current = null;
        hydratingRef.current = true;
        const empty = resolveProgramFromDocument(undefined);
        programRef.current = empty;
        setProgram(empty);
        setCurrentChapterId("");
        setCurrentPageIndex(0);
        hydratingRef.current = false;
      }
      return;
    }

    const document = currentProject.document;
    const projectChanged = hydratedProjectIdRef.current !== currentProject.id;
    if (!projectChanged) {
      if (documentRevision.origin === "program") {
        hydratedMotionRef.current = document.motion;
        return;
      }
      if (
        documentRevision.origin === "setup" &&
        hydratedMotionRef.current === document.motion
      ) {
        return;
      }
    }

    const nextProgram = resolveProgramFromDocument(document);
    const nextChapterId = nextProgram.chapters.some(
      (chapter) => chapter.id === currentChapterIdRef.current,
    )
      ? currentChapterIdRef.current
      : (nextProgram.chapters[0]?.id ?? "");
    const chapter =
      nextProgram.chapters.find((item) => item.id === nextChapterId) ??
      nextProgram.chapters[0];
    const total = programPageCount(chapter?.items ?? []);
    const nextPage = projectChanged
      ? 0
      : Math.min(currentPageIndexRef.current, total - 1);

    hydratingRef.current = true;
    programRef.current = nextProgram;
    setProgram(nextProgram);
    setCurrentChapterId(nextChapterId);
    setCurrentPageIndex(nextPage);
    hydratedProjectIdRef.current = currentProject.id;
    hydratedMotionRef.current = document.motion;
    hydratingRef.current = false;
  }, [currentProject?.id, currentProject?.document, documentRevision]);

  const currentChapter = useMemo(
    () => program.chapters.find((chapter) => chapter.id === currentChapterId) ?? program.chapters[0],
    [program.chapters, currentChapterId]
  );

  const totalPages = useMemo(() => programPageCount(currentChapter?.items ?? []), [currentChapter]);

  const pageItems = useMemo(
    () => ({ sequences: sliceProgramPage(currentChapter?.items ?? [], currentPageIndex) }),
    [currentChapter, currentPageIndex]
  );

  const isProgramEmpty = useMemo(
    () => isControlProgramEmpty(currentProject?.document, program),
    [currentProject?.document, program],
  );

  const commitProgramProjection = useCallback(
    (nextProgram: Program): boolean => {
      if (hydratingRef.current) return false;
      if (!currentProject?.document) return false;
      const result = updateCurrentDocument(
        (doc) => ({
          ...doc,
          motion: legacyProgramToMotion(nextProgram, doc.motion),
        }),
        "program",
      );
      if (!result.ok) {
        setLastPersistError(result.reason);
        return false;
      }
      setLastPersistError(null);
      programRef.current = nextProgram;
      setProgram(nextProgram);
      return true;
    },
    [currentProject?.document, updateCurrentDocument],
  );

  const mutateProgram = useCallback(
    (updater: (current: Program) => Program) => {
      const next = updater(programRef.current);
      if (next === programRef.current) return;
      commitProgramProjection(next);
    },
    [commitProgramProjection],
  );

  const setCurrentChapter = useCallback((chapterId: string) => {
    setCurrentChapterId(chapterId);
    setCurrentPageIndex(0);
  }, []);

  const nextPage = useCallback(() => {
    setCurrentPageIndex((current) => Math.min(totalPages - 1, current + 1));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setCurrentPageIndex((current) => Math.max(0, current - 1));
  }, []);

  const addChapter = useCallback(() => {
    mutateProgram((current) => {
      const id = `ch-${Date.now().toString(36)}`;
      return {
        ...current,
        chapters: [...current.chapters, { id, name: `新建章节-${current.chapters.length + 1}`, items: [] }],
      };
    });
  }, [mutateProgram]);

  const removeChapter = useCallback(
    (chapterId: string) => {
      mutateProgram((current) => ({
        ...current,
        chapters: current.chapters.filter((chapter) => chapter.id !== chapterId),
      }));
    },
    [mutateProgram],
  );

  const renameChapter = useCallback(
    (chapterId: string, name: string) => {
      mutateProgram((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) =>
          chapter.id === chapterId ? { ...chapter, name } : chapter
        ),
      }));
    },
    [mutateProgram],
  );

  const reorderItemInChapter = useCallback(
    (chapterId: string, fromIndex: number, toIndex: number) => {
      mutateProgram((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => {
          if (chapter.id !== chapterId) return chapter;
          const items = chapter.items.slice();
          const [removed] = items.splice(fromIndex, 1);
          items.splice(toIndex, 0, removed);
          return { ...chapter, items };
        }),
      }));
    },
    [mutateProgram],
  );

  const moveItemAcrossChapter = useCallback(
    (fromChapterId: string, fromIndex: number, toChapterId: string, toIndex: number) => {
      mutateProgram((current) => {
        const fromChapter = current.chapters.find((chapter) => chapter.id === fromChapterId);
        if (!fromChapter) return current;
        const item = fromChapter.items[fromIndex];
        if (!item) return current;
        return {
          ...current,
          chapters: current.chapters.map((chapter) => {
            if (chapter.id === fromChapterId && chapter.id === toChapterId) {
              const items = chapter.items.slice();
              items.splice(fromIndex, 1);
              items.splice(toIndex, 0, item);
              return { ...chapter, items };
            }
            if (chapter.id === fromChapterId) {
              const items = chapter.items.slice();
              items.splice(fromIndex, 1);
              return { ...chapter, items };
            }
            if (chapter.id === toChapterId) {
              const items = chapter.items.slice();
              items.splice(toIndex, 0, item);
              return { ...chapter, items };
            }
            return chapter;
          }),
        };
      });
    },
    [mutateProgram],
  );

  const addSequence = useCallback(
    (chapterId: string) => {
      if (hydratingRef.current) return;
      if (!currentProject?.document) return;
      const current = programRef.current;
      let id: number;
      try {
        [id] = allocateSequenceIdsInProject(currentProject.document.motion.actionSequences, 1);
      } catch (error) {
        setLastPersistError(error instanceof Error ? error.message : "动作序列 id 已满（1~65535）");
        return;
      }
      let found = false;
      const nextProgram: Program = {
        ...current,
        chapters: current.chapters.map((chapter) => {
          if (chapter.id !== chapterId) return chapter;
          found = true;
          return {
            ...chapter,
            items: [
              ...chapter.items,
              { kind: "sequence", sequence: { id, name: "新建动作序列", durationMs: 5000 } },
            ],
          };
        }),
      };
      if (!found) return;
      const createdSequence: ActionSequenceConfig = {
        id,
        name: "新建动作序列",
        trajectoryMode: "non-forced",
        blocks: [],
        segments: [],
      };
      const result = updateCurrentDocument(
        (doc) => {
          const motion = legacyProgramToMotion(nextProgram, doc.motion);
          return {
            ...doc,
            motion: {
              ...motion,
              actionSequences: [...motion.actionSequences, createdSequence],
            },
          };
        },
        "program",
      );
      if (!result.ok) {
        setLastPersistError(result.reason);
        return;
      }
      setLastPersistError(null);
      programRef.current = nextProgram;
      setProgram(nextProgram);
    },
    [currentProject?.document, updateCurrentDocument],
  );

  const removeItem = useCallback(
    (chapterId: string, index: number) => {
      mutateProgram((current) => ({
        ...current,
        chapters: current.chapters.map((chapter) => {
          if (chapter.id !== chapterId) return chapter;
          const items = chapter.items.slice();
          items.splice(index, 1);
          return { ...chapter, items };
        }),
      }));
    },
    [mutateProgram],
  );

  const value = useMemo(
    (): ProgramContextValue => ({
      program,
      currentChapterId,
      currentPageIndex,
      totalPages,
      pageItems,
      setCurrentChapter,
      nextPage,
      prevPage,
      addChapter,
      removeChapter,
      renameChapter,
      reorderItemInChapter,
      moveItemAcrossChapter,
      addSequence,
      removeItem,
      isProgramEmpty,
      lastPersistError,
    }),
    [
      program,
      isProgramEmpty,
      currentChapterId,
      currentPageIndex,
      totalPages,
      pageItems,
      setCurrentChapter,
      nextPage,
      prevPage,
      addChapter,
      removeChapter,
      renameChapter,
      reorderItemInChapter,
      moveItemAcrossChapter,
      addSequence,
      removeItem,
      lastPersistError,
    ]
  );

  return <ProgramContext.Provider value={value}>{children}</ProgramContext.Provider>;
};
