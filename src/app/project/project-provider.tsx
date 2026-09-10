import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createProjectConfigurationState,
  pushProjectHistory,
  redoProjectHistory,
  resetProjectHistory,
  restoreProjectConfiguration,
  undoProjectHistory,
  areSemanticallyEqual,
  captureProjectConfiguration,
  type ProjectConfigurationState,
  type ProjectHistoryState,
} from "./project-configuration-history";
import { applyDocumentUpdate } from "./project-document-update";
import type { ManualJogSettings, ProjectDocument } from "./project-document-types";
import { normalizeManualJog } from "./manual-jog";
import { validateProjectDocument } from "./project-document-validate";
import {
  getProjectAPI,
  hasProjectAPI,
  historyToVersionEntries,
  hydrateDocument,
  ProjectIpcError,
  summaryToRecord,
  toDocumentLike,
  unwrapResult,
} from "./project-ipc";
import {
  clearStoredCurrentFolderName,
  getStoredCurrentFolderName,
  setStoredCurrentFolderName,
} from "./project-storage";
import type { ProjectRecord } from "./project-types";
import { preloadMotorModelConfigs } from "@/app/pages/console/hooks/motor-config";
import { setLastOpenProjectAck } from "@/app/pages/console/hooks/project-verify";
import type { CppAckResult } from "@/types/electron";

export type DocumentMutationOrigin =
  | "setup"
  | "motion"
  | "program"
  | "project-command"
  | "history"
  | "version-restore";

export type DocumentRevision = {
  value: number;
  origin: DocumentMutationOrigin;
};

export type ProjectUpdateResult =
  | { ok: true; changed: boolean }
  | { ok: false; changed: false; reason: string };

export type ProjectHistoryResult =
  | { ok: true; changed: boolean; label?: string }
  | { ok: false; changed: false; reason: string };

type ProjectContextValue = {
  projects: ProjectRecord[];
  currentProject: ProjectRecord | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string) => void;
  selectedProject: ProjectRecord | null;
  /** 内存文档相对磁盘有未保存修改 */
  isDirty: boolean;
  /** 正在保存（含截图写盘） */
  isSaving: boolean;
  loading: boolean;
  error: string | null;
  refreshProjects: () => Promise<void>;
  openProject: (idOrFolderName: string) => Promise<CppAckResult | undefined>;
  closeProject: () => Promise<void>;
  createProject: (name: string) => Promise<string | null>;
  saveCurrentProject: (opts?: {
    view?: ProjectDocument["view"];
    coverPngBase64?: string | null;
  }) => Promise<void>;
  saveProjectAs: (newName: string) => Promise<void>;
  deleteProject: (folderName: string) => Promise<void>;
  importProject: (overwrite?: boolean) => Promise<void>;
  exportProject: (folderName?: string) => Promise<string | null>;
  refreshHistory: (folderName?: string) => Promise<void>;
  restoreVersion: (historyId: string) => Promise<void>;
  currentConfigurationStateId: string | null;
  documentRevision: DocumentRevision;
  canUndo: boolean;
  canRedo: boolean;
  /** 属性面板等 tracked edit 进行中（activeTransaction != null） */
  isTrackedEditActive: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  runTrackedDocumentUpdate: (
    label: string,
    updater: (document: ProjectDocument) => ProjectDocument,
    origin?: Extract<DocumentMutationOrigin, "setup" | "project-command">,
  ) => ProjectUpdateResult;
  persistManualJog: (jog: ManualJogSettings) => Promise<void>;
  beginTrackedEdit: (owner: string, label: string) => boolean;
  commitTrackedEdit: (owner: string) => ProjectUpdateResult;
  cancelTrackedEdit: (owner: string) => ProjectUpdateResult;
  undoProjectConfiguration: () => ProjectHistoryResult;
  redoProjectConfiguration: () => ProjectHistoryResult;
  updateCurrentDocument: (
    updater: (document: ProjectDocument) => ProjectDocument,
    origin?: Extract<DocumentMutationOrigin, "motion" | "program">,
  ) => ProjectUpdateResult;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filteredProjects: ProjectRecord[];
};

export const ProjectContext = createContext<ProjectContextValue | null>(null);

const createConfigurationStateId = (): string => crypto.randomUUID();

/** 进入软件后即存在；全进程只解析一次 */
let cachedCsocketApi: Window["csocketApi"] | null | undefined;

const getCsocketApi = (): Window["csocketApi"] | null => {
  if (cachedCsocketApi !== undefined) return cachedCsocketApi;
  cachedCsocketApi =
    typeof window !== "undefined" && window.csocketApi
      ? window.csocketApi
      : null;
  if (!cachedCsocketApi) {
    alert("csocketApi unavailable; skip CONFIG|Pro|open");
    return null;
  }
  return cachedCsocketApi;
};

const emptyHistory = (): ProjectHistoryState => ({
  past: [],
  future: [],
  activeTransaction: null,
  savedStateId: null,
});

const failUpdate = (reason: string): ProjectUpdateResult => ({
  ok: false,
  changed: false,
  reason,
});

const okUpdate = (changed: boolean): ProjectUpdateResult => ({
  ok: true,
  changed,
});

const failHistory = (reason: string): ProjectHistoryResult => ({
  ok: false,
  changed: false,
  reason,
});

const resolveFolderName = (
  projects: ProjectRecord[],
  idOrFolderName: string,
): string | null => {
  const byFolder = projects.find((p) => p.folderName === idOrFolderName);
  if (byFolder) return byFolder.folderName;
  const byId = projects.find((p) => p.id === idOrFolderName);
  return byId?.folderName ?? null;
};

export const ProjectProvider = ({ children }: { children: ReactNode }) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectRecord | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [history, setHistory] = useState<ProjectHistoryState>(emptyHistory);
  const [currentConfigurationState, setCurrentConfigurationState] =
    useState<ProjectConfigurationState | null>(null);
  const [documentRevision, setDocumentRevision] = useState<DocumentRevision>({
    value: 0,
    origin: "setup",
  });

  const projectsRef = useRef(projects);
  const currentProjectRef = useRef(currentProject);
  const historyRef = useRef(history);
  const currentConfigurationStateRef = useRef(currentConfigurationState);
  const revisionRef = useRef(documentRevision);
  const isSavingRef = useRef(false);
  const isRestoringVersionRef = useRef(false);
  const sessionLoadEpochRef = useRef(0);
  const activeTransactionOriginRef = useRef<
    Extract<DocumentMutationOrigin, "setup" | "project-command">
  >("setup");

  const isDirty =
    currentConfigurationState != null &&
    currentConfigurationState.id !== history.savedStateId;

  const isTrackedEditActive = history.activeTransaction != null;
  const historyBusy =
    isTrackedEditActive || isSaving || isRestoringVersion;
  const canUndo = !historyBusy && history.past.length > 0;
  const canRedo = !historyBusy && history.future.length > 0;
  const undoLabel = canUndo ? (history.past.at(-1)?.label ?? null) : null;
  const redoLabel = canRedo ? (history.future[0]?.label ?? null) : null;

  const filteredProjects = useMemo(() => {
    let list = projects;
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    return list;
  }, [projects, searchQuery]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? filteredProjects[0] ?? null,
    [projects, selectedProjectId, filteredProjects],
  );

  const replaceCurrentDocument = useCallback(
    (
      document: ProjectDocument,
      origin: DocumentMutationOrigin,
      configurationState: ProjectConfigurationState,
      touchModifiedAt: boolean,
    ) => {
      const current = currentProjectRef.current;
      if (!current) return;
      const result = applyDocumentUpdate(
        projectsRef.current,
        current.id,
        () => document,
        { touchModifiedAt },
      );
      if (!result.current) return;
      projectsRef.current = result.projects;
      currentProjectRef.current = result.current;
      currentConfigurationStateRef.current = configurationState;
      revisionRef.current = {
        value: revisionRef.current.value + 1,
        origin,
      };
      setProjects(result.projects);
      setCurrentProject(result.current);
      setCurrentConfigurationState(configurationState);
      setDocumentRevision(revisionRef.current);
    },
    [],
  );

  const resetSessionHistory = useCallback(
    (document: ProjectDocument, saved: boolean) => {
      const state = createProjectConfigurationState(
        createConfigurationStateId(),
        document,
      );
      const nextHistory = resetProjectHistory(
        state.id,
        saved ? state.id : null,
      );
      historyRef.current = nextHistory;
      currentConfigurationStateRef.current = state;
      setHistory(nextHistory);
      setCurrentConfigurationState(state);
      return state;
    },
    [],
  );

  const refreshProjects = useCallback(async () => {
    if (!hasProjectAPI()) {
      projectsRef.current = [];
      setProjects([]);
      setError("需在 Electron 中运行以访问本地工程");
      return;
    }
    const api = getProjectAPI();
    const summaries = unwrapResult(await api.list());
    setProjects((prev) => {
      const prevByFolder = new Map(prev.map((p) => [p.folderName, p]));
      const next = summaries.map((summary) => {
        const existing = prevByFolder.get(summary.name);
        return summaryToRecord(
          summary,
          existing?.document,
          existing?.versionHistory ?? [],
        );
      });
      projectsRef.current = next;
      return next;
    });
    setError(null);
  }, []);

  const openProject = useCallback(
    async (idOrFolderName: string) => {
      const api = getProjectAPI();
      const folderName =
        resolveFolderName(projectsRef.current, idOrFolderName) ??
        idOrFolderName.trim();
      if (!folderName) return;

      const epoch = ++sessionLoadEpochRef.current;
      // Supersede any in-flight restore so a winning open cannot leave restoring stuck.
      isRestoringVersionRef.current = false;
      setIsRestoringVersion(false);

      const { summary, document: raw } = unwrapResult(
        await api.open({ name: folderName }),
      );
      if (epoch !== sessionLoadEpochRef.current) return;

      const document = hydrateDocument(raw);
      const versionHistory = historyToVersionEntries(
        unwrapResult(await api.listHistory({ name: folderName })),
      );
      if (epoch !== sessionLoadEpochRef.current) return;

      const record = summaryToRecord(summary, document, versionHistory);
      const nextProjects = [
        record,
        ...projectsRef.current.filter((p) => p.folderName !== folderName),
      ];
      projectsRef.current = nextProjects;
      currentProjectRef.current = record;
      setProjects(nextProjects);
      setCurrentProject(record);
      setSelectedProjectId(record.id);
      resetSessionHistory(document, true);
      // 同工程 id 再 open 必须触发本地投影全量水合；不可用 setup（会被 ProjectStore own-write skip）
      revisionRef.current = {
        value: revisionRef.current.value + 1,
        origin: "version-restore",
      };
      setDocumentRevision(revisionRef.current);
      setStoredCurrentFolderName(folderName);
      setError(null);
      const csocketResult = await window.csocketApi.openProject([{ projectPath: summary.projectPath }]);
      setLastOpenProjectAck(csocketResult);
      return csocketResult;
    },
    [resetSessionHistory],
  );

  const closeProject = useCallback(async () => {
    if (hasProjectAPI()) {
      try {
        unwrapResult(await getProjectAPI().close());
      } catch {
        // 关闭指针失败不阻塞 UI
      }
    }
    clearStoredCurrentFolderName();
    setLastOpenProjectAck(null);
    currentProjectRef.current = null;
    currentConfigurationStateRef.current = null;
    historyRef.current = emptyHistory();
    setCurrentProject(null);
    setCurrentConfigurationState(null);
    setHistory(emptyHistory());
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const api = getProjectAPI();
      const summary = unwrapResult(
        await api.create({ name: trimmed, author: "当前用户" }),
      );
      await refreshProjects();
      setSelectedProjectId(summary.id);
      setError(null);
      return summary.id;
    },
    [refreshProjects],
  );

  const saveCurrentProject = useCallback(
    async (opts?: { view?: ProjectDocument["view"]; coverPngBase64?: string | null }) => {
      if (historyRef.current.activeTransaction) {
        throw new ProjectIpcError(
          "EDIT_IN_PROGRESS",
          "活动编辑事务进行中，无法保存",
        );
      }
      if (isRestoringVersionRef.current) {
        throw new ProjectIpcError(
          "RESTORE_IN_PROGRESS",
          "正在恢复版本，无法保存",
        );
      }
      const current = currentProjectRef.current;
      const configState = currentConfigurationStateRef.current;
      if (!current?.document || !configState) {
        throw new ProjectIpcError("NO_DOCUMENT", "当前没有可保存的工程文档");
      }
      const capturedStateId = configState.id;
      const capturedDocument: ProjectDocument = {
        ...current.document,
        view: opts?.view ?? current.document.view,
      };
      setIsSaving(true);
      isSavingRef.current = true;
      try {
        const api = getProjectAPI();
        if (current.folderName) {
          unwrapResult(await api.open({ name: current.folderName }));
        }
        const summary = unwrapResult(
          await api.save({
            document: toDocumentLike(capturedDocument),
            coverPngBase64: opts?.coverPngBase64 ?? undefined,
          }),
        );

        historyRef.current = {
          ...historyRef.current,
          savedStateId: capturedStateId,
        };
        setHistory(historyRef.current);

        const latest = currentProjectRef.current;
        const latestStateId = currentConfigurationStateRef.current?.id;
        const keepLatest =
          latestStateId != null &&
          latestStateId !== capturedStateId &&
          latest?.document != null;
        const finalDocument = keepLatest
          ? {
              ...latest!.document!,
              view: capturedDocument.view,
            }
          : capturedDocument;
        const next = summaryToRecord(
          summary,
          finalDocument,
          latest?.versionHistory ?? current.versionHistory,
        );
        if (keepLatest) {
          next.deviceCount =
            finalDocument.setup.plcs.length + finalDocument.setup.motors.length;
          next.controlledObjectCount =
            finalDocument.setup.controlledObjects.length;
          next.name = finalDocument.meta.name;
        }

        projectsRef.current = projectsRef.current.map((p) =>
          p.folderName === next.folderName ? next : p,
        );
        currentProjectRef.current = next;
        setProjects(projectsRef.current);
        setCurrentProject(next);
        setError(null);
      } finally {
        setIsSaving(false);
        isSavingRef.current = false;
      }
    },
    [],
  );

  const persistManualJog = useCallback(
    async (jog: ManualJogSettings): Promise<void> => {
      const current = currentProjectRef.current;
      const configState = currentConfigurationStateRef.current;
      if (!current?.document || !configState) {
        throw new ProjectIpcError("NO_DOCUMENT", "当前没有可保存的工程文档");
      }
      const nextJog = normalizeManualJog(jog);
      const currentJog = normalizeManualJog(current.document.setup.manualJog);
      if (areSemanticallyEqual(currentJog, nextJog)) {
        return;
      }
      const nextDoc: ProjectDocument = {
        ...current.document,
        setup: { ...current.document.setup, manualJog: nextJog },
      };
      const validation = validateProjectDocument(nextDoc);
      if (!validation.ok) {
        throw new ProjectIpcError(
          "VALIDATION",
          validation.errors[0] ?? "文档校验失败",
        );
      }
      const nextState = createProjectConfigurationState(
        createConfigurationStateId(),
        nextDoc,
      );
      // 不 pushProjectHistory —— 点动参数不进入撤销栈
      replaceCurrentDocument(nextDoc, "setup", nextState, true);
      await saveCurrentProject({});
    },
    [replaceCurrentDocument, saveCurrentProject],
  );

  const saveProjectAs = useCallback(
    async (newName: string) => {
      if (historyRef.current.activeTransaction) {
        throw new ProjectIpcError(
          "EDIT_IN_PROGRESS",
          "活动编辑事务进行中，无法保存",
        );
      }
      if (isRestoringVersionRef.current) {
        throw new ProjectIpcError(
          "RESTORE_IN_PROGRESS",
          "正在恢复版本，无法保存",
        );
      }
      const trimmed = newName.trim();
      if (!trimmed) {
        throw new ProjectIpcError("INVALID_NAME", "工程名不能为空");
      }
      const api = getProjectAPI();
      const sourceFolder =
        currentProjectRef.current?.folderName ?? selectedProject?.folderName;
      if (!sourceFolder) {
        throw new ProjectIpcError("NO_CURRENT", "请先选择或打开工程");
      }
      const current = currentProjectRef.current;
      if (current?.folderName !== sourceFolder) {
        unwrapResult(await api.open({ name: sourceFolder }));
        if (current?.document) {
          unwrapResult(
            await api.save({ document: toDocumentLike(current.document) }),
          );
        }
      } else if (current?.document) {
        unwrapResult(
          await api.save({ document: toDocumentLike(current.document) }),
        );
      } else {
        unwrapResult(await api.open({ name: sourceFolder }));
      }

      const summary = unwrapResult(await api.saveAs({ newName: trimmed }));
      await refreshProjects();
      await openProject(summary.name);
      setError(null);
    },
    [selectedProject, refreshProjects, openProject],
  );

  const deleteProject = useCallback(
    async (folderName: string) => {
      const api = getProjectAPI();
      unwrapResult(await api.delete({ name: folderName }));
      if (currentProjectRef.current?.folderName === folderName) {
        clearStoredCurrentFolderName();
        currentProjectRef.current = null;
        currentConfigurationStateRef.current = null;
        historyRef.current = emptyHistory();
        setCurrentProject(null);
        setCurrentConfigurationState(null);
        setHistory(emptyHistory());
      }
      await refreshProjects();
      setError(null);
    },
    [refreshProjects],
  );

  const importProject = useCallback(
    async (overwrite = false) => {
      const api = getProjectAPI();
      const summary = unwrapResult(await api.import({ overwrite }));
      await refreshProjects();
      setSelectedProjectId(summary.id);
      setError(null);
    },
    [refreshProjects],
  );

  const exportProject = useCallback(
    async (folderName?: string) => {
      const api = getProjectAPI();
      const name =
        folderName ??
        currentProjectRef.current?.folderName ??
        selectedProject?.folderName;
      if (!name) {
        throw new ProjectIpcError("NO_CURRENT", "请先选择要导出的工程");
      }
      const { filePath } = unwrapResult(await api.export({ name }));
      setError(null);
      return filePath;
    },
    [selectedProject?.folderName],
  );

  const refreshHistory = useCallback(
    async (folderName?: string) => {
      const name =
        folderName ??
        selectedProject?.folderName ??
        currentProjectRef.current?.folderName;
      if (!name || !hasProjectAPI()) return;
      const api = getProjectAPI();
      const entries = unwrapResult(await api.listHistory({ name }));
      const versionHistory = historyToVersionEntries(entries);
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.folderName === name ? { ...p, versionHistory } : p,
        );
        projectsRef.current = next;
        return next;
      });
      setCurrentProject((prev) => {
        const next =
          prev?.folderName === name ? { ...prev, versionHistory } : prev;
        currentProjectRef.current = next;
        return next;
      });
    },
    [selectedProject?.folderName],
  );

  const restoreVersion = useCallback(
    async (historyId: string) => {
      const api = getProjectAPI();
      const folderName =
        currentProjectRef.current?.folderName ?? selectedProject?.folderName;
      if (!folderName) {
        throw new ProjectIpcError("NO_CURRENT", "请先打开或选择工程");
      }
      const epoch = ++sessionLoadEpochRef.current;
      setIsRestoringVersion(true);
      isRestoringVersionRef.current = true;
      try {
        if (currentProjectRef.current?.folderName !== folderName) {
          unwrapResult(await api.open({ name: folderName }));
          if (epoch !== sessionLoadEpochRef.current) return;
        }
        const raw = unwrapResult(await api.restoreHistory({ historyId }));
        if (epoch !== sessionLoadEpochRef.current) return;
        const document = hydrateDocument(raw);
        const versionHistory = historyToVersionEntries(
          unwrapResult(await api.listHistory({ name: folderName })),
        );
        if (epoch !== sessionLoadEpochRef.current) return;
        const prev = currentProjectRef.current;
        const record = prev
          ? { ...prev, document, versionHistory, folderName }
          : summaryToRecord(
              {
                name: folderName,
                id: document.meta.id,
                author: document.meta.author,
                createdAt: document.meta.createdAt,
                modifiedAt: document.meta.modifiedAt,
                status: document.meta.status,
                schemaVersion: document.schemaVersion,
                sizeBytes: 0,
                hasCover: false,
                coverPath: null,
                coverDataUrl: null,
                projectPath: "",
                deviceCount: document.setup.plcs.length + document.setup.motors.length,
                controlledObjectCount: document.setup.controlledObjects.length,
              },
              document,
              versionHistory,
            );
        projectsRef.current = projectsRef.current.map((p) =>
          p.folderName === folderName ? { ...p, document, versionHistory } : p,
        );
        if (!projectsRef.current.some((p) => p.folderName === folderName)) {
          projectsRef.current = [record, ...projectsRef.current];
        }
        currentProjectRef.current = record;
        setProjects(projectsRef.current);
        setCurrentProject(record);
        const state = resetSessionHistory(document, true);
        currentConfigurationStateRef.current = state;
        revisionRef.current = {
          value: revisionRef.current.value + 1,
          origin: "version-restore",
        };
        setDocumentRevision(revisionRef.current);
        setError(null);
      } finally {
        if (epoch === sessionLoadEpochRef.current) {
          setIsRestoringVersion(false);
          isRestoringVersionRef.current = false;
        }
      }
    },
    [selectedProject?.folderName, resetSessionHistory],
  );

  const runTrackedDocumentUpdate = useCallback(
    (
      label: string,
      updater: (document: ProjectDocument) => ProjectDocument,
      origin: Extract<DocumentMutationOrigin, "setup" | "project-command"> = "setup",
    ): ProjectUpdateResult => {
      if (isRestoringVersionRef.current) {
        return failUpdate("正在恢复版本，无法修改工程配置");
      }
      const current = currentProjectRef.current;
      const configState = currentConfigurationStateRef.current;
      if (!current?.document || !configState) {
        return failUpdate("当前没有可更新的工程文档");
      }

      let nextDoc: ProjectDocument;
      try {
        nextDoc = updater(current.document);
      } catch (err) {
        return failUpdate(err instanceof Error ? err.message : String(err));
      }

      if (
        nextDoc.meta !== current.document.meta ||
        nextDoc.view !== current.document.view ||
        nextDoc.snapshots !== current.document.snapshots
      ) {
        return failUpdate("tracked updater 只能修改 setup/motion/rules");
      }

      const active = historyRef.current.activeTransaction;
      if (active) {
        if (origin === "project-command") {
          return failUpdate("活动事务进行中，无法执行 project-command");
        }
        activeTransactionOriginRef.current = origin;
        const previewState = createProjectConfigurationState(
          createConfigurationStateId(),
          nextDoc,
        );
        replaceCurrentDocument(nextDoc, origin, previewState, false);
        return okUpdate(true);
      }

      if (
        areSemanticallyEqual(
          configState.snapshot,
          captureProjectConfiguration(nextDoc),
        )
      ) {
        return okUpdate(false);
      }

      const validation = validateProjectDocument(nextDoc);
      if (!validation.ok) {
        return failUpdate(validation.errors[0] ?? "文档校验失败");
      }

      const nextState = createProjectConfigurationState(
        createConfigurationStateId(),
        nextDoc,
      );
      const nextHistory = pushProjectHistory(
        historyRef.current,
        configState,
        label,
        Date.now(),
      );
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      replaceCurrentDocument(nextDoc, origin, nextState, true);
      return okUpdate(true);
    },
    [replaceCurrentDocument],
  );

  const beginTrackedEdit = useCallback((owner: string, label: string): boolean => {
    if (isRestoringVersionRef.current) {
      return false;
    }
    if (!currentProjectRef.current?.document || !currentConfigurationStateRef.current) {
      return false;
    }
    if (historyRef.current.activeTransaction) {
      return false;
    }
    activeTransactionOriginRef.current = "setup";
    const nextHistory: ProjectHistoryState = {
      ...historyRef.current,
      activeTransaction: {
        owner,
        label,
        before: currentConfigurationStateRef.current,
      },
    };
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    return true;
  }, []);

  const commitTrackedEdit = useCallback(
    (owner: string): ProjectUpdateResult => {
      const active = historyRef.current.activeTransaction;
      if (!active) {
        return failUpdate("没有活动的编辑事务");
      }
      if (active.owner !== owner) {
        if (import.meta.env.DEV) {
          console.warn("commitTrackedEdit: owner mismatch", owner, active.owner);
        }
        return failUpdate("事务 owner 不匹配");
      }
      const current = currentProjectRef.current;
      const configState = currentConfigurationStateRef.current;
      if (!current?.document || !configState) {
        return failUpdate("当前没有可更新的工程文档");
      }

      const presentSnapshot = captureProjectConfiguration(current.document);
      if (areSemanticallyEqual(active.before.snapshot, presentSnapshot)) {
        const restored = restoreProjectConfiguration(
          current.document,
          active.before.snapshot,
        );
        historyRef.current = {
          ...historyRef.current,
          activeTransaction: null,
        };
        activeTransactionOriginRef.current = "setup";
        setHistory(historyRef.current);
        replaceCurrentDocument(restored, "history", active.before, false);
        return okUpdate(false);
      }

      const validation = validateProjectDocument(current.document);
      if (!validation.ok) {
        const restored = restoreProjectConfiguration(
          current.document,
          active.before.snapshot,
        );
        historyRef.current = {
          ...historyRef.current,
          activeTransaction: null,
        };
        activeTransactionOriginRef.current = "setup";
        setHistory(historyRef.current);
        replaceCurrentDocument(restored, "history", active.before, false);
        return failUpdate(validation.errors[0] ?? "文档校验失败");
      }

      const commitOrigin = activeTransactionOriginRef.current;
      const nextHistory = pushProjectHistory(
        {
          ...historyRef.current,
          activeTransaction: null,
        },
        active.before,
        active.label,
        Date.now(),
      );
      historyRef.current = nextHistory;
      activeTransactionOriginRef.current = "setup";
      setHistory(nextHistory);
      replaceCurrentDocument(current.document, commitOrigin, configState, true);
      return okUpdate(true);
    },
    [replaceCurrentDocument],
  );

  const cancelTrackedEdit = useCallback(
    (owner: string): ProjectUpdateResult => {
      const active = historyRef.current.activeTransaction;
      if (!active) {
        return failUpdate("没有活动的编辑事务");
      }
      if (active.owner !== owner) {
        if (import.meta.env.DEV) {
          console.warn("cancelTrackedEdit: owner mismatch", owner, active.owner);
        }
        return failUpdate("事务 owner 不匹配");
      }
      const current = currentProjectRef.current;
      if (!current?.document) {
        return failUpdate("当前没有可更新的工程文档");
      }
      const restored = restoreProjectConfiguration(
        current.document,
        active.before.snapshot,
      );
      historyRef.current = {
        ...historyRef.current,
        activeTransaction: null,
      };
      activeTransactionOriginRef.current = "setup";
      setHistory(historyRef.current);
      const changed = !areSemanticallyEqual(
        captureProjectConfiguration(current.document),
        active.before.snapshot,
      );
      replaceCurrentDocument(restored, "history", active.before, false);
      return okUpdate(changed);
    },
    [replaceCurrentDocument],
  );

  const undoProjectConfiguration = useCallback((): ProjectHistoryResult => {
    if (historyRef.current.activeTransaction) {
      return failHistory("活动事务进行中，请先提交或取消编辑");
    }
    if (isSavingRef.current || isRestoringVersionRef.current) {
      return failHistory("正在保存或恢复版本，无法撤销");
    }
    const current = currentProjectRef.current;
    const configState = currentConfigurationStateRef.current;
    if (!current?.document || !configState) {
      return failHistory("当前没有可更新的工程文档");
    }
    const transition = undoProjectHistory(
      historyRef.current,
      configState,
      Date.now(),
    );
    if (!transition) {
      return { ok: true, changed: false };
    }
    const restored = restoreProjectConfiguration(
      current.document,
      transition.current.snapshot,
    );
    historyRef.current = transition.history;
    setHistory(transition.history);
    replaceCurrentDocument(restored, "history", transition.current, false);
    return { ok: true, changed: true, label: transition.label };
  }, [replaceCurrentDocument]);

  const redoProjectConfiguration = useCallback((): ProjectHistoryResult => {
    if (historyRef.current.activeTransaction) {
      return failHistory("活动事务进行中，请先提交或取消编辑");
    }
    if (isSavingRef.current || isRestoringVersionRef.current) {
      return failHistory("正在保存或恢复版本，无法重做");
    }
    const current = currentProjectRef.current;
    const configState = currentConfigurationStateRef.current;
    if (!current?.document || !configState) {
      return failHistory("当前没有可更新的工程文档");
    }
    const transition = redoProjectHistory(
      historyRef.current,
      configState,
      Date.now(),
    );
    if (!transition) {
      return { ok: true, changed: false };
    }
    const restored = restoreProjectConfiguration(
      current.document,
      transition.current.snapshot,
    );
    historyRef.current = transition.history;
    setHistory(transition.history);
    replaceCurrentDocument(restored, "history", transition.current, false);
    return { ok: true, changed: true, label: transition.label };
  }, [replaceCurrentDocument]);

  const updateCurrentDocument = useCallback(
    (
      updater: (document: ProjectDocument) => ProjectDocument,
      origin: Extract<DocumentMutationOrigin, "motion" | "program"> = "motion",
    ): ProjectUpdateResult => {
      if (isRestoringVersionRef.current) {
        return failUpdate("正在恢复版本，无法修改工程配置");
      }
      if (historyRef.current.activeTransaction) {
        return failUpdate("活动事务进行中，无法执行非跟踪更新");
      }
      const current = currentProjectRef.current;
      const configState = currentConfigurationStateRef.current;
      if (!current?.document || !configState) {
        if (import.meta.env.DEV) {
          console.warn("updateCurrentDocument: no current project");
        }
        return failUpdate("当前没有可更新的工程文档");
      }

      let nextDoc: ProjectDocument;
      try {
        nextDoc = updater(current.document);
      } catch (err) {
        return failUpdate(err instanceof Error ? err.message : String(err));
      }

      if (nextDoc === current.document) {
        return okUpdate(false);
      }
      if (
        nextDoc.meta !== current.document.meta ||
        nextDoc.view !== current.document.view ||
        nextDoc.snapshots !== current.document.snapshots ||
        nextDoc.setup !== current.document.setup ||
        nextDoc.rules !== current.document.rules
      ) {
        return failUpdate("updateCurrentDocument 只能修改 motion");
      }
      if (nextDoc.motion === current.document.motion) {
        return okUpdate(false);
      }

      const validation = validateProjectDocument(nextDoc);
      if (!validation.ok) {
        return failUpdate(validation.errors[0] ?? "文档校验失败");
      }

      const nextState = createProjectConfigurationState(
        createConfigurationStateId(),
        nextDoc,
      );
      const nextHistory = resetProjectHistory(
        nextState.id,
        historyRef.current.savedStateId,
      );
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      replaceCurrentDocument(nextDoc, origin, nextState, true);
      return okUpdate(true);
    },
    [replaceCurrentDocument],
  );

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      setLoading(true);
      try {
        if (!hasProjectAPI()) {
          if (!cancelled) {
            projectsRef.current = [];
            setProjects([]);
            setError("需在 Electron 中运行以访问本地工程");
          }
          return;
        }
        await refreshProjects();
        void preloadMotorModelConfigs();
        const stored = getStoredCurrentFolderName();
        if (stored && !cancelled) {
          try {
            await openProject(stored);
          } catch (err) {
            clearStoredCurrentFolderName();
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          projectsRef.current = [];
          setProjects([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // 仅启动时加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      projects,
      currentProject,
      selectedProjectId,
      setSelectedProjectId,
      selectedProject,
      isDirty,
      isSaving,
      loading,
      error,
      refreshProjects,
      openProject,
      closeProject,
      createProject,
      saveCurrentProject,
      saveProjectAs,
      deleteProject,
      importProject,
      exportProject,
      refreshHistory,
      restoreVersion,
      currentConfigurationStateId: currentConfigurationState?.id ?? null,
      documentRevision,
      canUndo,
      canRedo,
      isTrackedEditActive,
      undoLabel,
      redoLabel,
      runTrackedDocumentUpdate,
      persistManualJog,
      beginTrackedEdit,
      commitTrackedEdit,
      cancelTrackedEdit,
      undoProjectConfiguration,
      redoProjectConfiguration,
      updateCurrentDocument,
      searchQuery,
      setSearchQuery,
      filteredProjects,
    }),
    [
      projects,
      currentProject,
      selectedProjectId,
      selectedProject,
      isDirty,
      isSaving,
      loading,
      error,
      refreshProjects,
      openProject,
      closeProject,
      createProject,
      saveCurrentProject,
      saveProjectAs,
      deleteProject,
      importProject,
      exportProject,
      refreshHistory,
      restoreVersion,
      currentConfigurationState?.id,
      documentRevision,
      canUndo,
      canRedo,
      isTrackedEditActive,
      undoLabel,
      redoLabel,
      runTrackedDocumentUpdate,
      persistManualJog,
      beginTrackedEdit,
      commitTrackedEdit,
      cancelTrackedEdit,
      undoProjectConfiguration,
      redoProjectConfiguration,
      updateCurrentDocument,
      searchQuery,
      filteredProjects,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
};
