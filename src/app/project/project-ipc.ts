import type {
  HistoryEntry,
  ProjectAPI,
  ProjectDocumentLike,
  ProjectResult,
  ProjectSummary,
} from "@/types/electron";
import { migrateActionSequenceProfiles } from "./action-sequence/migrate-motion-profiles";
import { assertProjectDocumentStructure } from "./project-document-assert";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
} from "./project-document-types";
import type { ProjectRecord, ProjectStatus, ProjectVersionEntry } from "./project-types";
import { formatProjectModifiedAt } from "./project-utils";

export class ProjectIpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectIpcError";
    this.code = code;
  }
}

export const hasProjectAPI = (): boolean =>
  typeof window !== "undefined" && typeof window.projectAPI !== "undefined";

export const getProjectAPI = (): ProjectAPI => {
  if (!hasProjectAPI()) {
    throw new ProjectIpcError("NO_API", "需在 Electron 中运行以访问本地工程");
  }
  return window.projectAPI;
};

export const unwrapResult = <T>(result: ProjectResult<T>): T => {
  if (!result.ok) {
    throw new ProjectIpcError(result.code, result.message);
  }
  return result.data;
};

const toStatus = (status?: string): ProjectStatus => {
  if (status === "active" || status === "draft" || status === "archived") return status;
  return "draft";
};

const formatDisplayTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatProjectModifiedAt(d);
};

export const historyToVersionEntries = (entries: HistoryEntry[]): ProjectVersionEntry[] =>
  entries.map((entry) => ({
    version: entry.label,
    date: entry.createdAt.slice(0, 10),
    historyId: entry.id,
  }));

export const summaryToRecord = (
  summary: ProjectSummary,
  document?: ProjectDocument,
  versionHistory: ProjectVersionEntry[] = [],
): ProjectRecord => ({
  id: summary.id,
  folderName: summary.name,
  name: summary.name,
  modifiedAt: formatDisplayTime(summary.modifiedAt),
  createdAt: formatDisplayTime(summary.createdAt),
  version: summary.schemaVersion,
  author: summary.author,
  sizeMb: Math.round((summary.sizeBytes / (1024 * 1024)) * 10) / 10,
  deviceCount: summary.deviceCount,
  controlledObjectCount: summary.controlledObjectCount,
  trussCount: 0,
  fixtureCount: 0,
  status: toStatus(summary.status),
  tags: [],
  recent: true,
  versionHistory,
  document,
  hasCover: summary.hasCover,
  coverPath: summary.coverPath,
  coverDataUrl: summary.coverDataUrl,
  projectPath: summary.projectPath,
});

export const toDocumentLike = (doc: ProjectDocument): ProjectDocumentLike =>
  JSON.parse(JSON.stringify(doc)) as ProjectDocumentLike;

export const hydrateDocument = (raw: ProjectDocumentLike): ProjectDocument => {
  const schemaVersion =
    raw && typeof raw === "object" && "schemaVersion" in raw
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version "${String(schemaVersion)}"; expected "${PROJECT_SCHEMA_VERSION}"`,
    );
  }
  const cloned = structuredClone(raw) as ProjectDocument;
  if (Array.isArray(cloned.motion?.actionSequences)) {
    cloned.motion.actionSequences = cloned.motion.actionSequences.map(
      migrateActionSequenceProfiles,
    );
  }
  assertProjectDocumentStructure(cloned);
  return cloned;
};
