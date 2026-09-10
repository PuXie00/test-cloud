import type { ProjectDocument } from "./project-document-types";
import { formatProjectModifiedAt } from "./project-utils";
import type { ProjectRecord } from "./project-types";

export type DocumentUpdateResult = {
  projects: ProjectRecord[];
  current: ProjectRecord | null;
};

export type ApplyDocumentUpdateOptions = {
  touchModifiedAt?: boolean;
};

export const applyDocumentUpdate = (
  projects: ProjectRecord[],
  currentProjectId: string | null,
  updater: (doc: ProjectDocument) => ProjectDocument,
  options?: ApplyDocumentUpdateOptions,
): DocumentUpdateResult => {
  if (!currentProjectId) {
    return { projects, current: null };
  }

  const touchModifiedAt = options?.touchModifiedAt !== false;
  const now = touchModifiedAt ? new Date() : null;
  const stamp = now ? formatProjectModifiedAt(now) : null;
  const metaStamp = now ? now.toISOString() : null;
  let nextCurrent: ProjectRecord | null = null;

  const nextProjects = projects.map((record) => {
    if (record.id !== currentProjectId || !record.document) {
      return record;
    }
    const nextDoc = updater(record.document);
    if (!touchModifiedAt || !stamp || !metaStamp) {
      const nextRecord: ProjectRecord = {
        ...record,
        name: nextDoc.meta.name,
        controlledObjectCount: nextDoc.setup.controlledObjects.length,
        deviceCount: nextDoc.setup.plcs.length + nextDoc.setup.motors.length,
        document: nextDoc,
      };
      nextCurrent = nextRecord;
      return nextRecord;
    }
    const nextMeta = { ...nextDoc.meta, modifiedAt: metaStamp };
    const withMeta: ProjectDocument = { ...nextDoc, meta: nextMeta };
    const nextRecord: ProjectRecord = {
      ...record,
      name: withMeta.meta.name,
      modifiedAt: stamp,
      controlledObjectCount: withMeta.setup.controlledObjects.length,
      deviceCount: withMeta.setup.plcs.length + withMeta.setup.motors.length,
      document: withMeta,
    };
    nextCurrent = nextRecord;
    return nextRecord;
  });

  return {
    projects: nextProjects,
    current: nextCurrent ?? projects.find((p) => p.id === currentProjectId) ?? null,
  };
};
