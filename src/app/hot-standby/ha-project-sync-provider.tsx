import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { setLastOpenProjectAck } from "@/app/pages/console/hooks/project-verify";
import { createDefaultSavedView } from "@/app/project/saved-view";
import { useProject } from "@/app/project/use-project";
import { buildBusyEntries } from "./ha-busy";
import { HaConfirmDialog } from "./ha-confirm-dialog";
import { HaProjectSync, type HaLocalStatus, type HaSyncSnapshot } from "./ha-project-sync";

const IDLE_SNAPSHOT: HaSyncSnapshot = {
  peerHolders: [],
  phase: "idle",
  standbys: {},
  confirm: null,
  lastSyncedAt: null,
};

type HaProjectSyncValue = {
  snapshot: HaSyncSnapshot;
  /** 备机：立即同步（重新核对一次） */
  resync: () => void;
  /** 本机在用的有变化 */
  setLocalStatus: (status: HaLocalStatus) => void;
  /** 另一台的修改应用到了本机（keys 是改了的项） */
  subscribeRemoteChanges: (listener: (event: { keys: string[]; byName: string }) => void) => () => void;
};

const HaProjectSyncContext = createContext<HaProjectSyncValue>({
  snapshot: IDLE_SNAPSHOT,
  resync: () => undefined,
  setLocalStatus: () => undefined,
  subscribeRemoteChanges: () => () => undefined,
});

const sha256Hex = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const noopSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE_SNAPSHOT;

/**
 * 主备热备的工程同步（界面这边）：把同步引擎接到工程文档和主进程。
 * 状态和消息直接从主进程的推送进引擎，保证先后顺序；文档变化、保存完成由这里转给引擎。
 * 没有 haAPI（浏览器、测试）时什么都不做。
 */
export const HaProjectSyncProvider = ({ children }: { children: ReactNode }) => {
  const project = useProject();
  const latest = useRef(project);
  latest.current = project;

  const engine = useMemo(() => {
    const api = typeof window === "undefined" ? undefined : window.haAPI;
    if (!api) return null;
    return new HaProjectSync({
      getDocument: () => latest.current.getCurrentDocument(),
      applyRemote: (updater, options) => latest.current.applyRemoteDocument(updater, options),
      reopenCpp: async () => {
        const projectPath = latest.current.currentProject?.projectPath;
        if (!projectPath || !window.csocketApi?.openProject) return;
        const ack = await window.csocketApi.openProject([{ projectPath }]);
        setLastOpenProjectAck(ack);
      },
      markSaved: () => latest.current.markDocumentSaved(),
      isDirty: () => latest.current.isDirty,
      post: (to, message) => api.post(to, message).catch(() => false),
      setSynced: (projectId, scope) => {
        void api.setSynced(projectId, scope ?? null).catch(() => undefined);
      },
      syncModels: (prefer) => {
        void api.syncModels?.(prefer)?.catch(() => undefined);
      },
      writeSynced: (parts) => api.writeSynced(parts).catch(() => undefined),
      backup: async (document, label, note) => {
        const result = await api.backup({ document, label, note }).catch(() => null);
        return result?.ok === true;
      },
      getRecord: (projectId) => api.getSyncRecord(projectId).catch(() => null),
      setRecord: (projectId, record) => api.setSyncRecord(projectId, record).catch(() => undefined),
      saveOnRequest: async () => {
        try {
          // 按需载入 3D 引擎模块：这里只在备机请主机保存时用，不让引擎进其它模块的依赖
          const { getViz3DEngine } = await import("@/app/viz3d");
          const viz = getViz3DEngine();
          const view = viz.getSavedView() ?? createDefaultSavedView();
          await latest.current.saveCurrentProject({ view, coverPngBase64: viz.captureCoverPngBase64() });
          toast.success("已按备机的请求保存工程");
        } catch (err) {
          toast.error(`按备机的请求保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
      },
      digest: sha256Hex,
      notify: (text, tone) => {
        if (tone === "warning") toast.warning(text);
        else toast.info(text);
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });
  }, []);

  useEffect(() => {
    const api = window.haAPI;
    if (!api || !engine) return;
    let cancelled = false;
    let received = false;
    const offState = api.onState((state) => {
      received = true;
      engine.updateHaState(state);
    });
    const offMessage = api.onMessage(({ from, message }) => engine.onMessage(from, message));
    void api
      .getState()
      .then((state) => {
        if (!cancelled && !received) engine.updateHaState(state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      offState();
      offMessage();
      engine.dispose();
    };
  }, [engine]);

  // 本机改了工程：按项发出去（拖动等事务进行中不发）
  const { documentRevision, isTrackedEditActive, isSaving, isDirty } = project;
  useEffect(() => {
    engine?.onLocalDocument(documentRevision.origin, isTrackedEditActive);
  }, [engine, documentRevision, isTrackedEditActive]);

  // 保存成功（保存结束且没有未保存的修改）
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (wasSavingRef.current && !isSaving && !isDirty) engine?.onLocalSaved();
    wasSavingRef.current = isSaving;
  }, [engine, isSaving, isDirty]);

  const subscribe = useMemo(
    () => (engine ? (listener: () => void) => engine.subscribe(listener) : noopSubscribe),
    [engine],
  );
  const getSnapshot = useMemo(() => (engine ? () => engine.getSnapshot() : idleSnapshot), [engine]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // 另一台在用的设备交给主进程拦指令（以物体为单位，连带它的电机）
  const setup = project.currentProject?.document?.setup ?? null;
  const busyKey = useMemo(
    () => JSON.stringify(buildBusyEntries(snapshot.peerHolders, setup)),
    [snapshot.peerHolders, setup],
  );
  useEffect(() => {
    const api = window.haAPI;
    if (!api || !engine) return;
    void api.setPeerBusy?.(JSON.parse(busyKey))?.catch(() => undefined);
  }, [engine, busyKey]);

  const resync = useCallback(() => engine?.resync(), [engine]);
  const setLocalStatus = useCallback((status: HaLocalStatus) => engine?.setLocalStatus(status), [engine]);
  const subscribeRemoteChanges = useCallback(
    (listener: (event: { keys: string[]; byName: string }) => void) =>
      engine ? engine.onRemoteChange(listener) : () => undefined,
    [engine],
  );
  const value = useMemo(
    () => ({ snapshot, resync, setLocalStatus, subscribeRemoteChanges }),
    [snapshot, resync, setLocalStatus, subscribeRemoteChanges],
  );

  return (
    <HaProjectSyncContext.Provider value={value}>
      {children}
      {engine && snapshot.confirm ? (
        <HaConfirmDialog info={snapshot.confirm} onChoose={(choice) => engine.resolveConfirm(choice)} />
      ) : null}
    </HaProjectSyncContext.Provider>
  );
};

export const useHaProjectSync = (): HaProjectSyncValue => useContext(HaProjectSyncContext);
