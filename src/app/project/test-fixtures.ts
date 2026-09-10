import { GZ_2025_DOCUMENT } from "./mock-documents/gz-2025.document";
import { SH_BALLET_DOCUMENT } from "./mock-documents/sh-ballet.document";
import type { ProjectDocument } from "./project-document-types";
import type { ProjectRecord } from "./project-types";
import { formatProjectModifiedAt } from "./project-utils";

export const documentToTestRecord = (document: ProjectDocument): ProjectRecord => {
  const stamp = formatProjectModifiedAt(new Date(document.meta.modifiedAt));
  return {
    id: document.meta.id,
    folderName: document.meta.name,
    name: document.meta.name,
    modifiedAt: stamp,
    createdAt: formatProjectModifiedAt(new Date(document.meta.createdAt)),
    version: document.schemaVersion,
    author: document.meta.author,
    sizeMb: 1,
    deviceCount: document.setup.plcs.length + document.setup.motors.length,
    controlledObjectCount: document.setup.controlledObjects.length,
    trussCount: 0,
    fixtureCount: 0,
    status: document.meta.status ?? "draft",
    tags: [],
    recent: true,
    versionHistory: [],
    document,
  };
};

export const GZ_2025_RECORD = documentToTestRecord(GZ_2025_DOCUMENT);
export const SH_BALLET_RECORD = documentToTestRecord(SH_BALLET_DOCUMENT);

/** 供 vitest 注入的最小 projectAPI（内存实现） */
export const createMemoryProjectAPI = (seed: ProjectRecord[] = [GZ_2025_RECORD, SH_BALLET_RECORD]) => {
  const projects = new Map(seed.map((p) => [p.folderName, structuredClone(p)]));
  let currentName: string | null = null;

  const toSummary = (record: ProjectRecord) => ({
    name: record.folderName,
    id: record.id,
    author: record.author,
    createdAt: record.document?.meta.createdAt ?? new Date().toISOString(),
    modifiedAt: record.document?.meta.modifiedAt ?? new Date().toISOString(),
    status: record.status,
    schemaVersion: record.document?.schemaVersion ?? "1.3.0-draft",
    sizeBytes: Math.round(record.sizeMb * 1024 * 1024),
    hasCover: Boolean(record.hasCover || record.coverDataUrl),
    coverPath: record.coverPath ?? null,
    coverDataUrl: record.coverDataUrl ?? null,
    projectPath: record.projectPath ?? `/tmp/Project/${record.folderName}`,
    deviceCount: record.deviceCount,
    controlledObjectCount: record.controlledObjectCount,
  });

  return {
    list: async () => ({
      ok: true as const,
      data: [...projects.values()].map(toSummary),
    }),
    create: async (params: { name: string; author?: string }) => {
      const { createEmptyDocument } = await import("./project-document-empty");
      const doc = createEmptyDocument({
        id: `id-${Date.now()}`,
        name: params.name,
        author: params.author ?? "tester",
      });
      const record = documentToTestRecord(doc);
      projects.set(record.folderName, record);
      currentName = record.folderName;
      return { ok: true as const, data: toSummary(record) };
    },
    open: async (params: { name: string }) => {
      const record = projects.get(params.name);
      if (!record?.document) {
        return { ok: false as const, code: "NOT_FOUND", message: "not found" };
      }
      currentName = params.name;
      return {
        ok: true as const,
        data: { summary: toSummary(record), document: structuredClone(record.document) },
      };
    },
    save: async (params: { document: ProjectDocument; coverPngBase64?: string }) => {
      if (!currentName) {
        return { ok: false as const, code: "NO_CURRENT", message: "no current" };
      }
      const prev = projects.get(currentName);
      if (!prev) {
        return { ok: false as const, code: "NOT_FOUND", message: "not found" };
      }
      const next = documentToTestRecord(params.document as ProjectDocument);
      next.folderName = currentName;
      if (params.coverPngBase64) {
        next.hasCover = true;
        next.coverDataUrl = params.coverPngBase64.startsWith("data:")
          ? params.coverPngBase64
          : `data:image/png;base64,${params.coverPngBase64}`;
      }
      projects.set(currentName, next);
      return { ok: true as const, data: toSummary(next) };
    },
    saveAs: async (params: { newName: string }) => {
      if (!currentName) {
        return { ok: false as const, code: "NO_CURRENT", message: "no current" };
      }
      const prev = projects.get(currentName);
      if (!prev?.document) {
        return { ok: false as const, code: "NOT_FOUND", message: "not found" };
      }
      const doc = structuredClone(prev.document);
      doc.meta = { ...doc.meta, id: `id-${Date.now()}`, name: params.newName };
      const next = documentToTestRecord(doc);
      projects.set(next.folderName, next);
      currentName = next.folderName;
      return { ok: true as const, data: toSummary(next) };
    },
    delete: async (params: { name: string }) => {
      projects.delete(params.name);
      if (currentName === params.name) currentName = null;
      return { ok: true as const, data: null };
    },
    close: async () => {
      currentName = null;
      return { ok: true as const, data: null };
    },
    listHistory: async () => ({ ok: true as const, data: [] }),
    backupHistory: async () => ({
      ok: false as const,
      code: "UNSUPPORTED",
      message: "not in memory api",
    }),
    restoreHistory: async () => ({
      ok: false as const,
      code: "UNSUPPORTED",
      message: "not in memory api",
    }),
    diffHistory: async () => ({ ok: true as const, data: [] }),
    export: async () => ({
      ok: false as const,
      code: "UNSUPPORTED",
      message: "not in memory api",
    }),
    import: async () => ({
      ok: false as const,
      code: "UNSUPPORTED",
      message: "not in memory api",
    }),
  };
};
