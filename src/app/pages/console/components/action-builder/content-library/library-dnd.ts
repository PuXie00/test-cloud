/** 内容库条目拖拽（拖入节目章节 / 时间轴轨道 / Cue 组合） */
export const LIBRARY_ITEM_MIME = "application/x-library-item";

/** 章节内条目重排拖拽 */
export const PROGRAM_ITEM_MIME = "application/x-program-item";

export type LibraryDragPayload = {
  kind: "cue" | "sequence";
  id: string;
};

export type ProgramItemDragPayload = {
  chapterId: string;
  index: number;
};

export const writeLibraryDrag = (dataTransfer: DataTransfer, payload: LibraryDragPayload): void => {
  dataTransfer.setData(LIBRARY_ITEM_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "copy";
};

export const isLibraryDrag = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes(LIBRARY_ITEM_MIME);

export const readLibraryDrag = (dataTransfer: DataTransfer): LibraryDragPayload | null => {
  const raw = dataTransfer.getData(LIBRARY_ITEM_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryDragPayload>;
    if ((parsed.kind === "cue" || parsed.kind === "sequence") && typeof parsed.id === "string") {
      return { kind: parsed.kind, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
};

export const cueIdFromLibraryDrag = (dataTransfer: DataTransfer): string | null => {
  const payload = readLibraryDrag(dataTransfer);
  if (!payload || payload.kind !== "cue") return null;
  return payload.id;
};

export const writeProgramItemDrag = (
  dataTransfer: DataTransfer,
  payload: ProgramItemDragPayload,
): void => {
  dataTransfer.setData(PROGRAM_ITEM_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = "move";
};

export const isProgramItemDrag = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes(PROGRAM_ITEM_MIME);

export const readProgramItemDrag = (
  dataTransfer: DataTransfer,
): ProgramItemDragPayload | null => {
  const raw = dataTransfer.getData(PROGRAM_ITEM_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProgramItemDragPayload>;
    if (typeof parsed.chapterId === "string" && typeof parsed.index === "number") {
      return { chapterId: parsed.chapterId, index: parsed.index };
    }
  } catch {
    return null;
  }
  return null;
};
