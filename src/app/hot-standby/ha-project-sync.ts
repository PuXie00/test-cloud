import type { HaAppMessage, HaPeerSyncState, HaStatusHolder } from "@shared/ha/protocol";
import {
  applySyncChange,
  changeTouchesSetup,
  describeSyncKey,
  diffSyncItems,
  extractSyncItems,
  filterSyncChange,
  isEmptySyncChange,
  replaceSyncScope,
  syncDigestSource,
  type HaSyncChange,
  type HaSyncItems,
} from "@shared/ha/sync-items";
import {
  DEFAULT_HA_SYNC_SCOPE,
  isHaPeerReady,
  type HaState,
  type HaSyncRecord,
  type HaSyncScope,
} from "@shared/ha/types";
import type { ProjectDocument } from "@/app/project/project-document-types";

/** 应用对方内容的结果（和 ProjectProvider 的 ProjectUpdateResult 一样） */
export type HaApplyResult = { ok: true; changed: boolean } | { ok: false; changed: false; reason: string };

/** 备机的核对阶段（方案 4.3） */
export type HaStandbyPhase = "idle" | "checking" | "confirm" | "pulling" | "pushing" | "synced";

/** 要问用户「用主机的 / 用本机的」时给弹窗的说明 */
export type HaConfirmInfo = {
  primaryName: string;
  /** 没有同步记录：第一次同步这个工程，或者改了同步范围 */
  noRecord: boolean;
  /** 备机离线期间改过 */
  standbyChanged: boolean;
  /** 记录里有未保存的修改（主机可能重启丢了，备机这里还留着） */
  unsavedOnRecord: boolean;
};

/** 本机在用的：物体或电机 id、在运行的动作 */
export type HaLocalStatus = { deviceIds: number[]; sequenceIds: number[] };

export type HaSyncSnapshot = {
  /** 另一台（主机上是所有备机，备机上是主机和其它备机）在用的 */
  peerHolders: HaStatusHolder[];
  /** 备机：本机的核对阶段；主机为 idle */
  phase: HaStandbyPhase;
  /** 主机：每台备机的核对状态 */
  standbys: Record<string, HaPeerSyncState>;
  /** 备机：要问用户时的说明 */
  confirm: HaConfirmInfo | null;
  lastSyncedAt: number | null;
};

export type HaSyncPorts = {
  getDocument: () => ProjectDocument | null;
  /** 当前文档；要同步读（应用完对方内容紧接着读要拿到新的） */
  applyRemote: (
    updater: (document: ProjectDocument) => ProjectDocument,
    options: { check: boolean; reopen?: boolean },
  ) => HaApplyResult;
  /** 备机用了主机的整份、配置变了：写盘后让本机 C++ 重新打开工程（方案 4.4） */
  reopenCpp: () => Promise<void>;
  markSaved: () => void;
  isDirty: () => boolean;
  post: (to: string[] | "all", message: HaAppMessage) => Promise<boolean>;
  setSynced: (projectId: string | null, scope?: HaSyncScope) => void;
  /** 备机核对完成：两边补齐模型文件，同名不同内容用 prefer 那边的 */
  syncModels: (prefer: "primary" | "standby") => void;
  writeSynced: (parts: {
    projectId: string;
    setup: unknown;
    motion?: unknown;
    rules?: unknown;
    meta?: unknown;
    view?: unknown;
  }) => Promise<unknown>;
  backup: (document: ProjectDocument, label: string, note?: string) => Promise<boolean>;
  getRecord: (projectId: string) => Promise<HaSyncRecord | null>;
  setRecord: (projectId: string, record: HaSyncRecord | null) => Promise<void>;
  /** 主机：备机请主机保存 */
  saveOnRequest: () => Promise<void>;
  digest: (text: string) => Promise<string>;
  notify: (text: string, tone: "info" | "warning") => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
};

/** 备机写 project.json 最多 3 秒一次（方案 5.7） */
export const HA_WRITE_THROTTLE_MS = 3000;
/** 本机刚改过的项：这么久以内被另一台的修改覆盖，提示一下（方案 5.3） */
export const HA_RECENT_EDIT_MS = 15_000;

const toItems = (entries: [string, unknown][]): HaSyncItems => new Map(entries);

const applyToItems = (items: HaSyncItems, change: HaSyncChange): HaSyncItems => {
  const next = new Map(items);
  for (const key of change.del) next.delete(key);
  for (const [key, value] of Object.entries(change.put)) next.set(key, value);
  return next;
};

const sameScope = (a: HaSyncScope, b: HaSyncScope): boolean =>
  a.motion === b.motion && a.rules === b.rules && a.meta === b.meta && a.models === b.models;

/**
 * 工程同步（界面这边，方案第 4、5 节）：
 * - 连上、同一个工程后，主机发 sync-hello（摘要、同步范围）；备机比对，一样就「已同步」，
 *   离线没改过就直接用主机的，否则问用户用哪边的（整份二选一）；
 * - 日常按项发改动；主机按收到的先后应用（按本机锁和校验，不行就退回），再发给所有备机，以主机发来的为准；
 * - 同一项后到的覆盖先到的，被覆盖的那台提示一下；
 * - 主机保存后通知备机；备机应用同步内容后把这些部分写进 project.json。
 * 主进程只转发消息；配置下发由工程存储按差异做（来源 remote，备机上主进程自动带「不写 PLC」标志）。
 */
export class HaProjectSync {
  private ha: HaState | null = null;
  private projectId: string | null = null;
  private scope: HaSyncScope = DEFAULT_HA_SYNC_SCOPE;
  /** 两边认可的内容；本机的修改跟它比出改了哪几项 */
  private baseline: HaSyncItems | null = null;
  private phase: HaStandbyPhase = "idle";
  private confirmInfo: HaConfirmInfo | null = null;
  private readonly standbys = new Map<string, HaPeerSyncState>();
  /** 主机：还没核对完的备机，核对开始以后主机发出的改动先排着，它报「已同步」后按顺序补发 */
  private readonly backlog = new Map<string, HaAppMessage[]>();
  /** 备机：上一次的二选一说明（主机没用本机的内容时回到二选一） */
  private lastConfirm: HaConfirmInfo | null = null;
  /** 备机：这次核对选的是不是「用本机的」（模型文件同名不同内容时用哪边的） */
  private preferLocal = false;
  /** 备机：发出去还没被主机发回的项 */
  private readonly pending = new Map<string, number>();
  /** 备机：本机刚改过的项和时间 */
  private readonly recent = new Map<string, number>();
  /** 本机正在拖动等（事务进行中）时，收到的改动先排着 */
  private readonly queue: (() => void)[] = [];
  private trackedActive = false;
  private lastSyncedAt: number | null = null;
  private cancelWrite: (() => void) | null = null;
  /** 有一次写盘排着（计时器可能同步就跑了，不能只看 cancelWrite） */
  private writeScheduled = false;
  private lastWriteAt = 0;
  private reconcileToken = 0;
  private readonly listeners = new Set<() => void>();
  /** 另一台的修改应用到了本机（编辑器看本机草稿是不是被对方改了） */
  private readonly remoteListeners = new Set<(event: { keys: string[]; byName: string }) => void>();
  /** 备机：主机保存时带来的视角，下次写盘时写进去 */
  private pendingView: unknown = undefined;
  private snapshot: HaSyncSnapshot = {
    peerHolders: [],
    phase: "idle",
    standbys: {},
    confirm: null,
    lastSyncedAt: null,
  };
  private localStatus: HaLocalStatus = { deviceIds: [], sequenceIds: [] };
  /** 收到的 status：来自哪台 → 它报的（主机发来的里面还有其它备机的） */
  private readonly peerHolders = new Map<string, HaStatusHolder[]>();

  constructor(private readonly ports: HaSyncPorts) {}

  // ── 订阅（界面显示核对状态、弹二选一） ──

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): HaSyncSnapshot {
    return this.snapshot;
  }

  onRemoteChange(listener: (event: { keys: string[]; byName: string }) => void): () => void {
    this.remoteListeners.add(listener);
    return () => {
      this.remoteListeners.delete(listener);
    };
  }

  private emitRemoteChange(keys: string[], byName: string): void {
    if (keys.length === 0) return;
    for (const listener of this.remoteListeners) listener({ keys, byName });
  }

  private emit(): void {
    this.snapshot = {
      peerHolders: [...this.peerHolders.values()].flat(),
      phase: this.phase,
      standbys: Object.fromEntries(this.standbys),
      confirm: this.confirmInfo,
      lastSyncedAt: this.lastSyncedAt,
    };
    for (const listener of this.listeners) listener();
  }

  private get role() {
    return this.ha?.role ?? "primary";
  }

  private get selfIp(): string {
    return this.ha?.localIp ?? "";
  }

  // ── 热备状态 ──

  updateHaState(state: HaState | null): void {
    const previous = this.ha;
    this.ha = state;
    const projectId = state?.enabled ? (state.localProject?.id ?? null) : null;
    if (!state?.enabled || !projectId || projectId !== this.projectId || previous?.role !== state.role) {
      this.resetAll(projectId);
    }
    if (!state?.enabled || !projectId) return;

    if (state.role === "primary") {
      if (!sameScope(this.scope, state.syncScope)) {
        // 主机改了同步范围：所有备机重新核对（方案 3.2）
        this.scope = state.syncScope;
        this.baseline = null;
        for (const ip of this.standbys.keys()) this.standbys.set(ip, "checking");
        void this.sendPrimaryHello([...this.standbys.keys()]);
      }
      const ready = state.peers.filter((peer) => isHaPeerReady(peer, state.localProject)).map((peer) => peer.ip);
      let holdersChanged = false;
      for (const ip of [...this.standbys.keys()]) {
        if (ready.includes(ip)) continue;
        this.standbys.delete(ip);
        this.backlog.delete(ip);
        holdersChanged = this.peerHolders.delete(ip) || holdersChanged;
      }
      if (holdersChanged) this.sendStatus();
      // 备机连上后由备机发起核对（发 sync-hello 请主机回），这里只记下
      for (const ip of ready) {
        if (!this.standbys.has(ip)) this.standbys.set(ip, "checking");
      }
      this.emit();
      return;
    }

    const primary = state.peers.find((peer) => peer.ip === state.primaryIp);
    const ready = primary ? isHaPeerReady(primary, state.localProject) : false;
    if (!ready && this.phase !== "idle") {
      void this.onStandbyLost();
    } else if (ready && this.phase === "idle") {
      // 请主机发 sync-hello（主机连上时已经发过；本机界面刷新过也能补上）
      this.phase = "checking";
      void this.ports.post([state.primaryIp], { type: "sync-hello", projectId, digest: "", state: "checking" });
      this.emit();
    }
  }

  private resetAll(projectId: string | null): void {
    const wasSynced = this.phase === "synced";
    this.projectId = projectId;
    this.baseline = null;
    this.phase = "idle";
    this.confirmInfo = null;
    this.standbys.clear();
    this.backlog.clear();
    this.peerHolders.clear();
    this.lastConfirm = null;
    this.pending.clear();
    this.recent.clear();
    this.queue.length = 0;
    this.reconcileToken += 1;
    this.cancelScheduledWrite();
    if (wasSynced || this.ha?.role === "standby") this.ports.setSynced(null);
    this.scope = this.ha?.role === "primary" ? (this.ha.syncScope ?? DEFAULT_HA_SYNC_SCOPE) : DEFAULT_HA_SYNC_SCOPE;
    this.emit();
  }

  /** 备机和主机断开：记下断开时两边认可的内容，重新连上时判断离线期间改没改过（方案 4.3） */
  private async onStandbyLost(): Promise<void> {
    const projectId = this.projectId;
    const baseline = this.baseline;
    const wasSynced = this.phase === "synced";
    this.phase = "idle";
    this.baseline = null;
    this.confirmInfo = null;
    this.pending.clear();
    this.peerHolders.clear();
    this.reconcileToken += 1;
    this.ports.setSynced(null);
    this.emit();
    if (!wasSynced || !projectId || !baseline) return;
    const digest = await this.ports.digest(syncDigestSource(baseline));
    await this.ports.setRecord(projectId, {
      digest,
      dirty: this.ports.isDirty(),
      at: new Date(this.ports.now()).toISOString(),
    });
  }

  /** 主进程先报了工程、界面还没载入完时，过一会儿再试（最多约 10 秒） */
  private retry(job: () => void, attempt: number): void {
    if (attempt >= 20) return;
    const projectId = this.projectId;
    this.ports.setTimer(() => {
      if (this.projectId === projectId) job();
    }, 500);
  }

  private localItems(): HaSyncItems | null {
    const document = this.ports.getDocument();
    return document ? extractSyncItems(document, this.scope) : null;
  }

  private async sendPrimaryHello(to: string[], reply = false, attempt = 0): Promise<void> {
    const projectId = this.projectId;
    if (!projectId || to.length === 0) return;
    const items = this.localItems();
    if (!items) {
      this.retry(() => void this.sendPrimaryHello(to, reply, attempt + 1), attempt);
      return;
    }
    // 从这一刻的内容开始核对：之后主机的改动要跟它比出来，给这些备机排着
    if (!this.baseline) this.baseline = items;
    for (const ip of to) this.backlog.set(ip, []);
    const digest = await this.ports.digest(syncDigestSource(items));
    if (projectId !== this.projectId) return;
    await this.ports.post(to, {
      type: "sync-hello",
      projectId,
      digest,
      scope: this.scope,
      ...(reply ? { reply: true } : {}),
    });
  }

  // ── 本机改了工程 ──

  /** 文档有变化时调；本机的修改（不是同步来的）按项发出去。拖动等事务进行中不发，松手才算提交 */
  onLocalDocument(origin: string, trackedActive: boolean): void {
    const wasActive = this.trackedActive;
    this.trackedActive = trackedActive;
    if (wasActive && !trackedActive) this.flushQueue();
    if (origin === "remote" || trackedActive || !this.projectId || !this.baseline) return;
    const items = this.localItems();
    if (!items) return;
    const change = diffSyncItems(this.baseline, items);
    if (isEmptySyncChange(change)) return;
    this.baseline = items;
    const message: HaAppMessage = {
      type: "change",
      projectId: this.projectId,
      origin: this.selfIp,
      originName: this.ha?.hostName ?? "",
      put: change.put,
      del: change.del,
    };
    const now = this.ports.now();
    if (this.role === "primary") {
      for (const key of [...Object.keys(change.put), ...change.del]) this.recent.set(key, now);
      this.broadcastChange(message);
      return;
    }
    if (this.phase !== "synced" || !this.ha) return;
    for (const key of [...Object.keys(change.put), ...change.del]) {
      this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
      this.recent.set(key, now);
    }
    void this.ports.post([this.ha.primaryIp], message);
  }

  /** 本机在用的有变化（界面算好交过来）：发给已同步的另一台（方案 6.6） */
  setLocalStatus(status: HaLocalStatus): void {
    const next = {
      deviceIds: [...new Set(status.deviceIds)].sort((a, b) => a - b),
      sequenceIds: [...new Set(status.sequenceIds)].sort((a, b) => a - b),
    };
    if (
      next.deviceIds.join(",") === this.localStatus.deviceIds.join(",") &&
      next.sequenceIds.join(",") === this.localStatus.sequenceIds.join(",")
    ) {
      return;
    }
    this.localStatus = next;
    this.sendStatus();
  }

  /** 发 status：主机给每台已同步的备机发「主机 + 其它备机」的，备机给主机发自己的；only 只发给这一台 */
  private sendStatus(only?: string): void {
    const projectId = this.projectId;
    if (!projectId || !this.ha) return;
    const self: HaStatusHolder = { name: this.ha.hostName, ...this.localStatus };
    if (this.role === "standby") {
      if (this.phase !== "synced") return;
      void this.ports.post([this.ha.primaryIp], { type: "status", projectId, holders: [self] });
      return;
    }
    for (const [ip, state] of this.standbys) {
      if (state !== "synced" || (only && ip !== only)) continue;
      const holders = [self];
      for (const [from, list] of this.peerHolders) if (from !== ip) holders.push(...list);
      void this.ports.post([ip], { type: "status", projectId, holders });
    }
  }

  /** 主机发改动：已同步的备机直接发，正在核对的排着 */
  private broadcastChange(message: HaAppMessage, exclude?: string): void {
    const synced: string[] = [];
    for (const [ip, state] of this.standbys) {
      if (ip === exclude) continue;
      if (state === "synced") synced.push(ip);
      else this.backlog.get(ip)?.push(message);
    }
    if (synced.length > 0) void this.ports.post(synced, message);
  }

  /** 本机保存成功后调：主机通知备机；备机请主机也保存（方案 5.5） */
  onLocalSaved(): void {
    const projectId = this.projectId;
    if (!projectId) return;
    if (this.role === "primary") {
      const synced = [...this.standbys].filter(([, state]) => state === "synced").map(([ip]) => ip);
      // 带上视角：备机写进 project.json（方案 5.5）
      const view = this.ports.getDocument()?.view;
      if (synced.length > 0) void this.ports.post(synced, { type: "save", projectId, ...(view ? { view } : {}) });
      return;
    }
    if (this.phase === "synced" && this.ha) {
      void this.ports.post([this.ha.primaryIp], { type: "save", projectId, request: true });
    }
  }

  private flushQueue(): void {
    const jobs = this.queue.splice(0);
    for (const job of jobs) job();
  }

  private whenIdle(job: () => void): void {
    if (this.trackedActive) this.queue.push(job);
    else job();
  }

  // ── 收到另一台的消息 ──

  onMessage(from: string, message: HaAppMessage): void {
    if (!this.ha?.enabled || !this.projectId || message.projectId !== this.projectId) return;
    if (this.role === "standby" && from !== this.ha.primaryIp) return;
    switch (message.type) {
      case "sync-hello":
        if (this.role === "primary") this.onStandbyHello(from, message.state, message.reply === true);
        else void this.reconcile(message.digest, message.scope ?? DEFAULT_HA_SYNC_SCOPE);
        return;
      case "pull":
        if (this.role === "primary") {
          this.backlog.set(from, []);
          void this.sendFull([from]);
        }
        return;
      case "full":
        if (this.role === "primary") this.whenIdle(() => void this.applyStandbyFull(from, message.items));
        else this.whenIdle(() => void this.applyPrimaryFull(message.items));
        return;
      case "change":
        if (this.role === "primary") this.whenIdle(() => this.applyAsPrimary(from, message));
        else this.whenIdle(() => this.applyAsStandby(message));
        return;
      case "save":
        if (this.role === "primary" && message.request) {
          void this.ports.saveOnRequest();
        } else if (this.role === "standby" && !message.request && this.phase === "synced") {
          this.ports.markSaved();
          if (this.scope.meta && message.view !== undefined) this.pendingView = message.view;
          this.scheduleWrite(true);
        }
        return;
      case "status":
        this.peerHolders.set(from, Array.isArray(message.holders) ? message.holders : []);
        // 主机：把备机报的转给其它备机
        if (this.role === "primary") {
          for (const ip of this.standbys.keys()) if (ip !== from) this.sendStatus(ip);
        }
        this.emit();
        return;
      case "notice":
        this.ports.notify(message.text, "warning");
        // 主机没用本机的内容：回到二选一
        if (this.role === "standby" && this.phase === "pushing" && this.lastConfirm) {
          this.phase = "confirm";
          this.confirmInfo = this.lastConfirm;
          this.emit();
        }
        return;
    }
  }

  private onStandbyHello(from: string, state: HaPeerSyncState | undefined, reply: boolean): void {
    // 主进程只转发能同步的备机的消息；界面状态可能比消息晚到一步，没记下的先补上
    const next = state ?? "checking";
    this.standbys.set(from, next);
    if (next === "synced") {
      if (!this.baseline) this.baseline = this.localItems();
      const queued = this.backlog.get(from) ?? [];
      this.backlog.delete(from);
      for (const message of queued) void this.ports.post([from], message);
      this.sendStatus(from);
    }
    // 备机请主机发 sync-hello（它刚连上、界面刷新过、或者点了立即同步）
    if (next === "checking" && !reply) void this.sendPrimaryHello([from], true);
    this.emit();
  }

  private async sendFull(to: string[]): Promise<void> {
    const projectId = this.projectId;
    const items = this.localItems();
    if (!projectId || !items) return;
    if (!this.baseline) this.baseline = items;
    await this.ports.post(to, { type: "full", projectId, scope: this.scope, items: [...items] });
  }

  // ── 备机核对（方案 4.3） ──

  private async reconcile(primaryDigest: string, scope: HaSyncScope, attempt = 0): Promise<void> {
    if (!this.ports.getDocument()) {
      this.retry(() => void this.reconcile(primaryDigest, scope, attempt + 1), attempt);
      return;
    }
    const token = ++this.reconcileToken;
    const projectId = this.projectId;
    if (!projectId || !this.ha) return;
    const scopeChanged = !sameScope(this.scope, scope);
    this.scope = scope;
    this.phase = "checking";
    this.confirmInfo = null;
    this.ports.setSynced(null);
    this.emit();
    const items = this.localItems();
    if (!items) return;
    const digest = await this.ports.digest(syncDigestSource(items));
    if (token !== this.reconcileToken) return;
    if (digest === primaryDigest) {
      await this.markStandbySynced(items, digest);
      return;
    }
    const record = scopeChanged ? null : await this.ports.getRecord(projectId);
    if (token !== this.reconcileToken) return;
    if (record && record.digest === digest && !record.dirty) {
      this.pull();
      return;
    }
    const primary = this.ha.peers.find((peer) => peer.ip === this.ha?.primaryIp);
    this.phase = "confirm";
    this.confirmInfo = {
      primaryName: primary?.hostName ?? "主机",
      noRecord: !record,
      standbyChanged: record !== null && record.digest !== digest,
      unsavedOnRecord: record?.dirty ?? false,
    };
    this.lastConfirm = this.confirmInfo;
    void this.ports.post([this.ha.primaryIp], { type: "sync-hello", projectId, digest, state: "confirm" });
    this.emit();
  }

  /** 备机上用户选了用哪边的 */
  resolveConfirm(choice: "primary" | "local"): void {
    if (this.role !== "standby" || this.phase !== "confirm" || !this.ha || !this.projectId) return;
    this.confirmInfo = null;
    if (choice === "primary") {
      this.pull();
      return;
    }
    const items = this.localItems();
    if (!items) return;
    this.preferLocal = true;
    this.phase = "pushing";
    this.emit();
    void this.ports.post([this.ha.primaryIp], {
      type: "full",
      projectId: this.projectId,
      scope: this.scope,
      items: [...items],
    });
  }

  private pull(): void {
    if (!this.ha || !this.projectId) return;
    this.phase = "pulling";
    this.emit();
    void this.ports.post([this.ha.primaryIp], { type: "pull", projectId: this.projectId });
  }

  private async markStandbySynced(items: HaSyncItems, digest: string): Promise<void> {
    const projectId = this.projectId;
    if (!projectId || !this.ha) return;
    this.baseline = items;
    this.phase = "synced";
    this.confirmInfo = null;
    this.pending.clear();
    this.lastSyncedAt = this.ports.now();
    this.ports.setSynced(projectId, this.scope);
    this.ports.syncModels(this.preferLocal ? "standby" : "primary");
    this.preferLocal = false;
    this.emit();
    void this.ports.post([this.ha.primaryIp], { type: "sync-hello", projectId, digest, state: "synced" });
    this.sendStatus();
    await this.ports.setRecord(projectId, {
      digest,
      dirty: this.ports.isDirty(),
      at: new Date(this.ports.now()).toISOString(),
    });
  }

  /** 备机：用主机的整份（先存版本备份）；配置变了，写盘后让 C++ 重新打开工程 */
  private async applyPrimaryFull(entries: [string, unknown][]): Promise<void> {
    if (this.phase !== "pulling" && this.phase !== "checking") return;
    const token = this.reconcileToken;
    const document = this.ports.getDocument();
    if (!document) return;
    await this.ports.backup(document, "热备同步前自动备份", "用主机的内容覆盖本机之前的版本");
    if (token !== this.reconcileToken) return;
    const items = toItems(entries);
    const before = extractSyncItems(this.ports.getDocument() ?? document, this.scope);
    const setupChanged = !isEmptySyncChange(
      diffSyncItems(
        new Map([...before].filter(([key]) => key.startsWith("setup:"))),
        new Map([...items].filter(([key]) => key.startsWith("setup:"))),
      ),
    );
    const result = this.ports.applyRemote((doc) => replaceSyncScope(doc, items, this.scope), {
      check: false,
      reopen: setupChanged,
    });
    if (!result.ok) {
      this.ports.notify(`用主机的内容失败：${result.reason}`, "warning");
      return;
    }
    const applied = this.localItems() ?? items;
    this.cancelScheduledWrite();
    await this.writeNow();
    if (setupChanged) await this.ports.reopenCpp();
    if (token !== this.reconcileToken) return;
    await this.markStandbySynced(applied, await this.ports.digest(syncDigestSource(applied)));
  }

  /** 主机：备机选了「用本机的」，用备机的整份（先存版本备份），再告诉所有备机 */
  private async applyStandbyFull(from: string, entries: [string, unknown][]): Promise<void> {
    const projectId = this.projectId;
    const document = this.ports.getDocument();
    if (!projectId || !document) return;
    await this.ports.backup(document, "热备同步前自动备份", `用备机 ${from} 的内容覆盖本机之前的版本`);
    const before = this.baseline ?? extractSyncItems(document, this.scope);
    const items = toItems(entries);
    const result = this.ports.applyRemote((doc) => replaceSyncScope(doc, items, this.scope), { check: true });
    if (!result.ok) {
      void this.ports.post([from], {
        type: "notice",
        projectId,
        text: `主机没有用备机的内容：${result.reason}。处理后在备机上点「立即同步」重试`,
      });
      return;
    }
    const after = this.localItems() ?? items;
    this.baseline = after;
    // 其它备机按日常改动跟上
    const change = diffSyncItems(before, after);
    if (!isEmptySyncChange(change)) {
      this.broadcastChange(
        {
          type: "change",
          projectId,
          origin: from,
          originName: this.peerName(from),
          put: change.put,
          del: change.del,
        },
        from,
      );
    }
    await this.sendPrimaryHello([from], true);
  }

  // ── 日常改动（方案 5.2–5.4） ──

  private peerName(ip: string): string {
    return this.ha?.peers.find((peer) => peer.ip === ip)?.hostName ?? ip;
  }

  /** 主机按收到的先后应用备机的修改，再发给所有备机；应用不了就把主机当前的内容退回给它 */
  private applyAsPrimary(from: string, message: Extract<HaAppMessage, { type: "change" }>): void {
    const projectId = this.projectId;
    if (!projectId || this.standbys.get(from) !== "synced") return;
    const change = filterSyncChange({ put: message.put, del: message.del }, this.scope);
    if (isEmptySyncChange(change)) return;
    const result = this.ports.applyRemote((doc) => applySyncChange(doc, change), { check: true });
    if (!result.ok) {
      const current = this.localItems() ?? new Map();
      const keys = [...Object.keys(change.put), ...change.del];
      const put: Record<string, unknown> = {};
      const del: string[] = [];
      for (const key of keys) {
        if (current.has(key)) put[key] = current.get(key);
        else del.push(key);
      }
      void this.ports.post([from], {
        type: "change",
        projectId,
        origin: this.selfIp,
        originName: this.ha?.hostName ?? "",
        put,
        del,
        bounce: result.reason,
      });
      return;
    }
    if (this.baseline) this.baseline = applyToItems(this.baseline, change);
    this.notifyOverwritten(
      [...Object.keys(change.put), ...change.del],
      change,
      message.originName || this.peerName(from),
    );
    this.emitRemoteChange([...Object.keys(change.put), ...change.del], message.originName || this.peerName(from));
    this.broadcastChange({
      type: "change",
      projectId,
      origin: message.origin || from,
      originName: message.originName || this.peerName(from),
      put: change.put,
      del: change.del,
    });
  }

  /** 备机按主机发来的顺序应用，以主机发来的为准 */
  private applyAsStandby(message: Extract<HaAppMessage, { type: "change" }>): void {
    if (this.phase !== "synced" || !this.baseline) return;
    const change = filterSyncChange({ put: message.put, del: message.del }, this.scope);
    const keys = [...Object.keys(change.put), ...change.del];
    const own = message.origin === this.selfIp && !message.bounce;
    if (!isEmptySyncChange(change)) {
      const result = this.ports.applyRemote((doc) => applySyncChange(doc, change), { check: false });
      if (!result.ok) {
        // 应用不了（例如正在恢复版本）：重新核对一次，以主机的为准
        this.phase = "checking";
        this.emit();
        void this.ports.post([this.ha?.primaryIp ?? ""], {
          type: "sync-hello",
          projectId: this.projectId ?? "",
          digest: "",
          state: "checking",
        });
        return;
      }
      this.baseline = applyToItems(this.baseline, change);
      this.scheduleWrite(false);
    }
    if (message.bounce) {
      this.ports.notify(`修改被主机退回：${message.bounce}`, "warning");
    }
    const now = this.ports.now();
    const overwritten: string[] = [];
    for (const key of keys) {
      const inFlight = this.pending.get(key) ?? 0;
      if (own) {
        if (inFlight <= 1) this.pending.delete(key);
        else this.pending.set(key, inFlight - 1);
        continue;
      }
      if (message.bounce) {
        this.pending.delete(key);
        continue;
      }
      // 本机的修改还在路上：它会晚到，反过来覆盖对方的，不提示
      if (inFlight > 0) continue;
      overwritten.push(key);
    }
    this.notifyOverwritten(overwritten, change, message.originName || "另一台");
    if (!own && !message.bounce) this.emitRemoteChange(keys, message.originName || "另一台");
    if (changeTouchesSetup(change)) this.lastSyncedAt = now;
  }

  /** 本机刚改过的项被另一台的修改覆盖了：提示一下（方案 5.3） */
  private notifyOverwritten(keys: string[], change: HaSyncChange, byName: string): void {
    const now = this.ports.now();
    const hit = keys.filter((key) => {
      const editedAt = this.recent.get(key);
      return editedAt !== undefined && now - editedAt <= HA_RECENT_EDIT_MS;
    });
    if (hit.length === 0) return;
    const first = hit[0];
    const name = describeSyncKey(first, change.put[first] ?? this.baseline?.get(first));
    const more = hit.length > 1 ? ` 等 ${hit.length} 项` : "";
    this.ports.notify(`${name}${more}被 ${byName} 改了`, "info");
    for (const key of hit) this.recent.delete(key);
  }

  // ── 备机写盘（方案 5.7） ──

  private scheduleWrite(force: boolean): void {
    if (this.role !== "standby" || this.writeScheduled) return;
    this.writeScheduled = true;
    const wait = force ? 0 : Math.max(0, this.lastWriteAt + HA_WRITE_THROTTLE_MS - this.ports.now());
    const cancel = this.ports.setTimer(() => {
      this.writeScheduled = false;
      this.cancelWrite = null;
      void this.writeNow();
    }, wait);
    // 计时器已经同步跑完时不留取消函数
    this.cancelWrite = this.writeScheduled ? cancel : null;
  }

  private cancelScheduledWrite(): void {
    this.cancelWrite?.();
    this.cancelWrite = null;
    this.writeScheduled = false;
  }

  private async writeNow(): Promise<void> {
    const projectId = this.projectId;
    const document = this.ports.getDocument();
    if (!projectId || !document || document.meta.id !== projectId) return;
    this.lastWriteAt = this.ports.now();
    const view = this.pendingView;
    this.pendingView = undefined;
    await this.ports.writeSynced({
      projectId,
      setup: document.setup,
      ...(this.scope.motion ? { motion: document.motion } : {}),
      ...(this.scope.rules ? { rules: document.rules } : {}),
      ...(this.scope.meta ? { meta: document.meta } : {}),
      ...(view !== undefined ? { view } : {}),
    });
  }

  /** 备机上点「立即同步」：重新核对一次 */
  resync(): void {
    if (this.role !== "standby" || !this.ha || !this.projectId || this.phase === "idle") return;
    this.phase = "checking";
    this.ports.setSynced(null);
    this.emit();
    void this.ports.post([this.ha.primaryIp], { type: "sync-hello", projectId: this.projectId, digest: "", state: "checking" });
  }

  /** 卸载时清计时器；订阅由订阅方自己退 */
  dispose(): void {
    this.cancelScheduledWrite();
  }
}
