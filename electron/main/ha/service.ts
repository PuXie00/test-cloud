import type { CppAckResult } from '../../../shared/csocket/types'
import {
  classifyHaCommand,
  isHaLinkCommand,
  isHaSyncedCommand,
} from '../../../shared/ha/command-class'
import { commandActionIds, commandDeviceIds } from '../../../shared/ha/device-ids'
import {
  HA_MESSAGE_VERSION,
  parseHaMessage,
  type HaAppMessage,
  type HaCmdMessage,
  type HaFileMessage,
  type HaForwardEnvelope,
  type HaHelloMessage,
  type HaMessage,
} from '../../../shared/ha/protocol'
import {
  normalizeHaSettings,
  validateHaSettings,
  type HaLinkState,
  type HaPeerView,
  type HaProjectInfo,
  type HaResult,
  type HaRole,
  type HaSettings,
  type HaState,
  type HaSyncScope,
} from '../../../shared/ha/types'
import type { ProjectFileEvent } from '../project/file-events'
import { modelBundleSha256, type HaFilesPort } from './files'
import { HaTransport, type HaTransportOptions } from './transport'

export type HaStartParams =
  | { role: 'primary'; ip: string }
  | { role: 'standby'; ip: string; primaryIp: string }

/** 热备用到的本机 C++ 接口（CsocketApiService 实现） */
export type HaCsocketPort = {
  haStart: (params: HaStartParams) => Promise<CppAckResult>
  haStop: () => Promise<CppAckResult>
  /** HA|send，不等应答；返回是否交给了 C++ */
  haSend: (to: string[], payload: unknown) => Promise<boolean>
  /** 把另一台同步来的指令带「不写 PLC」标志交给本机 C++ */
  sendForwarded: (envelope: HaForwardEnvelope) => Promise<CppAckResult>
}

export type HaSettingsStorage = {
  load: () => Promise<unknown | null>
  save: (settings: HaSettings) => Promise<void>
}

/** 指令发出前的判断：拦下，或者要不要带「不写 PLC」标志 */
export type HaCommandGate = { block: string } | { noPlc: boolean }

/** 另一台在用的设备（物体或电机 id，全局互斥），界面按对方发来的 status 算好交过来 */
export type HaBusyEntry = { id: number; label: string; by: string }

export type HaServiceDeps = {
  csocket: HaCsocketPort
  storage: HaSettingsStorage
  /** 本机名称的默认值（电脑名） */
  defaultHostName: string
  /** 热备状态有变化 */
  onState: (state: HaState) => void
  /** 另一台发来的工程同步消息（界面处理） */
  onAppMessage?: (from: string, message: HaAppMessage) => void
  /** 指令被热备规则拦下（界面提示原因） */
  onBlocked?: (optCmd: string, reason: string) => void
  /** 工程目录的模型、封面（方案 5.6）；不给就不同步文件 */
  files?: HaFilesPort
  /** 收到另一台的模型文件、删了模型：界面重新载入模型 */
  onModelsChanged?: () => void
  log?: (message: string) => void
  transport?: Partial<HaTransportOptions>
}

type PeerState = {
  ip: string
  link: HaLinkState
  /** 最近一次收到的 hello；断开后留着，界面还要显示对方名称 */
  hello: HaHelloMessage | null
  closedByPeer: boolean
}

/** 开启时的设置；开着的时候只有同步范围能改 */
type ActiveConfig = {
  role: HaRole
  hostName: string
  localIp: string
  primaryIp: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sameProject = (a: HaProjectInfo | null, b: HaProjectInfo | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.id === b.id && a.name === b.name && a.formatVersion === b.formatVersion)

const ok = <T>(data: T): HaResult<T> => ({ ok: true, data })
const fail = (code: string, message: string): HaResult<never> => ({ ok: false, code, message })

const describeAckFailure = (ack: CppAckResult): string =>
  ack.code === 'SEND_FAILED' || ack.code === 'ACK_TIMEOUT' || ack.code === 'NOT_CONNECTED'
    ? 'C++ 没有回应（没连上，或者还不支持热备）'
    : ack.message || 'C++ 回复失败'

/** 只留要转发的字段：报文里的 messageId、时间戳等由接收方的本机 C++ 链路重新生成 */
const toForwardEnvelope = (envelope: HaForwardEnvelope): HaForwardEnvelope => ({
  OptCmd: envelope.OptCmd,
  addr: envelope.addr,
  params: envelope.params,
  ...(envelope.paramHeard && envelope.paramHeard.length > 0 ? { paramHeard: envelope.paramHeard } : {}),
  ...(envelope.userName ? { userName: envelope.userName } : {}),
})

/**
 * 主备热备的主进程部分（方案第 4、6、7 节）：
 * - 开启、关闭：经本机 C++ 的 HA|start / HA|stop；C++ 搭链路、只当管道；
 * - 链路状态（HA|info）、收到的消息（HA|haRecv）；连上后互发 hello，判断是不是同一个工程；
 * - 指令同步：本机执行的写指令发给另一台（停止类立即发，其它执行成功后发），
 *   收到的一律带「不写 PLC」标志交给本机 C++；
 * - 备机的指令规则：配置带标志，整台 PLC 的指令不能做，没核对完只能停止、急停。
 */
export class HaService {
  private settings: HaSettings | null = null
  private active: ActiveConfig | null = null
  private starting = false
  private error: string | null = null
  private localProject: HaProjectInfo | null = null
  /** 和主机核对完成的工程 id（备机）；核对在工程同步里做，没核对完只能停止、急停 */
  private syncedProjectId: string | null = null
  /** 备机：主机发来的同步范围（核对完成时界面交过来），决定同步不同步模型 */
  private syncedScope: HaSyncScope | null = null
  private readonly peers = new Map<string, PeerState>()
  private readonly transport: HaTransport
  private lastEmitted = ''
  /** 另一台在用的设备：本机不能操作（停止、急停除外，方案 6.4） */
  private peerBusy = new Map<number, HaBusyEntry>()
  /** 每个动作最近一次由哪台准备、启动：另一台的动作，C++ 推来的 Info|act 不交给本机界面 */
  private readonly actionOwners = new Map<number, 'local' | 'peer'>()

  constructor(private readonly deps: HaServiceDeps) {
    this.transport = new HaTransport((to, payload) => deps.csocket.haSend(to, payload), deps.transport)
  }

  private log(message: string): void {
    this.deps.log?.(`[ha] ${message}`)
  }

  get enabled(): boolean {
    return this.active !== null
  }

  async getSettings(): Promise<HaSettings> {
    if (!this.settings) {
      let raw: unknown = null
      try {
        raw = await this.deps.storage.load()
      } catch (err) {
        this.log(`读热备设置失败：${err instanceof Error ? err.message : String(err)}`)
      }
      this.settings = normalizeHaSettings(raw, this.deps.defaultHostName)
    }
    return this.settings
  }

  /** 开着的时候只能改同步范围（主机），其它要先关闭热备 */
  async saveSettings(input: unknown): Promise<HaResult<HaSettings>> {
    const current = await this.getSettings()
    const next = normalizeHaSettings(input, this.deps.defaultHostName)
    if (this.active || this.starting) {
      const changedOther =
        next.role !== current.role ||
        next.hostName !== current.hostName ||
        next.localIp !== current.localIp ||
        next.primaryIp !== current.primaryIp
      if (changedOther) return fail('HA_ENABLED', '关闭热备后才能修改角色、名称和 IP')
    }
    try {
      await this.deps.storage.save(next)
    } catch (err) {
      return fail('SAVE_FAILED', `保存热备设置失败：${err instanceof Error ? err.message : String(err)}`)
    }
    this.settings = next
    this.emit()
    return ok(next)
  }

  async start(): Promise<HaResult<HaState>> {
    if (this.active) return ok(this.getState())
    if (this.starting) return fail('BUSY', '正在开启热备')
    const settings = await this.getSettings()
    const problem = validateHaSettings(settings)
    if (problem) return fail('INVALID_SETTINGS', problem)

    this.starting = true
    try {
      const ack = await this.deps.csocket.haStart(this.startParams(settings))
      if (!ack.success) {
        this.error = `开启热备失败：${describeAckFailure(ack)}`
        this.emit()
        return fail('START_FAILED', this.error)
      }
      this.active = {
        role: settings.role,
        hostName: settings.hostName,
        localIp: settings.localIp,
        primaryIp: settings.primaryIp,
      }
      this.error = null
      this.peers.clear()
      this.syncedProjectId = null
      if (settings.role === 'standby') {
        this.peers.set(settings.primaryIp, {
          ip: settings.primaryIp,
          link: 'connecting',
          hello: null,
          closedByPeer: false,
        })
      }
      this.log(`已开启：${settings.role === 'primary' ? '主机' : '备机'} ${settings.localIp}`)
      this.emit()
      return ok(this.getState())
    } finally {
      this.starting = false
    }
  }

  private startParams(settings: HaSettings): HaStartParams {
    return settings.role === 'primary'
      ? { role: 'primary', ip: settings.localIp }
      : { role: 'standby', ip: settings.localIp, primaryIp: settings.primaryIp }
  }

  async stop(): Promise<HaResult<HaState>> {
    const active = this.active
    if (!active) return ok(this.getState())
    // 主机主动关闭：先告诉备机，备机显示「主机已关闭热备」，不当成断线（方案 9.2）
    if (active.role === 'primary') {
      const targets = this.upPeers()
      if (targets.length > 0) await this.transport.send(targets, this.hello(false, true))
    }
    this.active = null
    this.syncedProjectId = null
    this.syncedScope = null
    this.transport.dispose()
    this.peers.clear()
    this.peerBusy = new Map()
    this.actionOwners.clear()
    const ack = await this.deps.csocket.haStop()
    this.error = ack.success ? null : `关闭热备时 ${describeAckFailure(ack)}`
    this.log('已关闭')
    this.emit()
    return ok(this.getState())
  }

  /** 本机 C++ 断开、重连：断开时对方都算断开；重连后 C++ 里的热备没了，按原设置重新开启 */
  onCsocketConnection(state: string): void {
    const active = this.active
    if (!active) return
    if (state !== 'connected') {
      let changed = false
      for (const peer of this.peers.values()) {
        if (peer.link === 'up') this.onPeerLost(peer)
        if (peer.link !== 'down') {
          peer.link = 'down'
          changed = true
        }
      }
      if (changed) this.emit()
      return
    }
    void this.deps.csocket
      .haStart(
        active.role === 'primary'
          ? { role: 'primary', ip: active.localIp }
          : { role: 'standby', ip: active.localIp, primaryIp: active.primaryIp },
      )
      .then((ack) => {
        if (ack.success || !this.active) return
        this.error = `重新开启热备失败：${describeAckFailure(ack)}`
        this.emit()
      })
  }

  /** 本机打开、关闭、另存工程时调；变了就重发 hello */
  setLocalProject(info: HaProjectInfo | null): void {
    if (sameProject(this.localProject, info)) return
    this.localProject = info
    if (this.syncedProjectId !== info?.id) this.syncedProjectId = null
    const targets = this.upPeers()
    if (this.active && targets.length > 0) void this.transport.send(targets, this.hello(false))
    this.emit()
  }

  /** 工程同步核对完成（备机）：之后备机才能操作设备（方案 6.5）；scope 是主机的同步范围 */
  setSynced(projectId: string | null, scope?: HaSyncScope | null): void {
    this.syncedScope = projectId ? (scope ?? this.syncedScope) : null
    if (this.syncedProjectId === projectId) return
    this.syncedProjectId = projectId
    this.emit()
  }

  // ── 模型、封面文件（方案 5.6） ──

  /** 同步范围里有这一部分：主机看本机设置，备机看核对时主机发来的 */
  private scopeIncludes(part: 'models' | 'meta'): boolean {
    const active = this.active
    if (!active || !this.localProject || !this.deps.files) return false
    if (active.role === 'primary') return this.settings?.syncScope[part] ?? false
    return this.syncedProjectId === this.localProject.id && this.syncedScope?.[part] === true
  }

  /** 发文件给谁：能同步的另一台；备机要核对完成 */
  private fileTargets(): string[] {
    if (this.active?.role === 'standby' && this.syncedProjectId !== this.localProject?.id) return []
    return this.syncTargets()
  }

  /** 本机导入、删除了模型，保存写了封面：发给另一台 */
  onProjectFileEvent(event: ProjectFileEvent): void {
    const project = this.localProject
    const files = this.deps.files
    if (!this.active || !project || !files || event.projectName !== project.name) return
    const targets = this.fileTargets()
    if (targets.length === 0) return
    if (event.kind === 'model-import' && this.scopeIncludes('models')) {
      void this.sendModels(targets, [event.fileName])
    } else if (event.kind === 'model-delete' && this.scopeIncludes('models')) {
      void this.transport.send(targets, { type: 'model-delete', projectId: project.id, name: event.fileName })
    } else if (event.kind === 'saved' && event.coverWritten && this.active.role === 'primary' && this.scopeIncludes('meta')) {
      void files.readCover().then((cover) => {
        if (!cover || this.localProject?.id !== project.id) return
        void this.transport.send(targets, {
          type: 'cover-file',
          projectId: project.id,
          fileName: cover.fileName,
          data: cover.data.toString('base64'),
        })
      })
    }
  }

  private async sendModels(targets: string[], names: string[]): Promise<void> {
    const project = this.localProject
    const files = this.deps.files
    if (!project || !files) return
    for (const name of names) {
      try {
        const bundle = await files.readModel(name)
        if (!bundle || this.localProject?.id !== project.id) continue
        const message: HaFileMessage = {
          type: 'model-file',
          projectId: project.id,
          name,
          sha256: modelBundleSha256(bundle),
          data: bundle.data.toString('base64'),
          ...(bundle.assets.length > 0
            ? { assets: bundle.assets.map((asset) => ({ name: asset.name, data: asset.data.toString('base64') })) }
            : {}),
        }
        const sent = await this.transport.send(targets, message)
        if (!sent) this.log(`模型 ${name} 没发出去`)
      } catch (err) {
        this.log(`读模型 ${name} 失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** 备机核对完成后调：把本机的模型清单发给主机，两边补齐（方案 4.3：缺的补上，同名不同用选中那边的，多的不删） */
  async syncModels(prefer: 'primary' | 'standby'): Promise<void> {
    const project = this.localProject
    const files = this.deps.files
    if (this.active?.role !== 'standby' || !project || !files || !this.scopeIncludes('models')) return
    const targets = this.fileTargets()
    if (targets.length === 0) return
    try {
      const manifest = await files.listModels()
      await this.transport.send(targets, { type: 'model-manifest', projectId: project.id, files: manifest, prefer })
    } catch (err) {
      this.log(`读模型清单失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async onFileMessage(from: string, message: HaFileMessage): Promise<void> {
    const project = this.localProject
    const files = this.deps.files
    if (!project || !files || message.projectId !== project.id) return
    try {
      switch (message.type) {
        case 'model-file': {
          if (!this.scopeIncludes('models')) return
          const bundle = {
            data: Buffer.from(message.data, 'base64'),
            assets: (message.assets ?? []).map((asset) => ({ name: asset.name, data: Buffer.from(asset.data, 'base64') })),
          }
          const written = await files.writeModel(message.name, bundle, message.sha256)
          if (!written) {
            this.log(`模型 ${message.name} 校验没通过，没写入`)
            return
          }
          this.deps.onModelsChanged?.()
          this.relayToOtherStandbys(from, message)
          return
        }
        case 'model-delete':
          if (!this.scopeIncludes('models')) return
          await files.deleteModel(message.name)
          this.deps.onModelsChanged?.()
          this.relayToOtherStandbys(from, message)
          return
        case 'model-manifest': {
          if (this.active?.role !== 'primary' || !this.scopeIncludes('models')) return
          const mine = new Map((await files.listModels()).map((file) => [file.name, file.sha256]))
          const theirs = new Map(message.files.map((file) => [file.name, file.sha256]))
          const send: string[] = []
          const request: string[] = []
          for (const [name, sha] of mine) {
            const other = theirs.get(name)
            if (other === undefined) send.push(name)
            else if (other !== sha) (message.prefer === 'primary' ? send : request).push(name)
          }
          for (const name of theirs.keys()) if (!mine.has(name)) request.push(name)
          if (request.length > 0) {
            void this.transport.send([from], { type: 'model-request', projectId: project.id, names: request })
          }
          await this.sendModels([from], send)
          return
        }
        case 'model-request':
          if (!this.scopeIncludes('models')) return
          await this.sendModels([from], message.names)
          return
        case 'cover-file':
          if (this.active?.role !== 'standby' || !this.scopeIncludes('meta')) return
          await files.writeCover(message.fileName, Buffer.from(message.data, 'base64'))
          return
      }
    } catch (err) {
      this.log(`处理 ${message.type} 失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 主机收到一台备机的模型改动：转给其它备机（备机只连主机） */
  private relayToOtherStandbys(from: string, message: HaFileMessage): void {
    if (this.active?.role !== 'primary') return
    const others = this.syncTargets().filter((ip) => ip !== from)
    if (others.length > 0) void this.transport.send(others, message)
  }

  // ── C++ 推送 ──

  /**
   * HA|info：data[0] = { role, peers: [{ ip }] }，只在变化时推。
   * peers 只列连着的（2026-11-20 定，没有 link 字段）：在列表里就是连着，不在就是没连上；
   * 版本不一致等连不上的也不列。主机上是连着的备机，备机上是主机（连着时）。
   */
  ingestInfoHa(result: CppAckResult | undefined): void {
    const active = this.active
    if (!active) return
    const data = result?.data?.[0]
    if (!isRecord(data) || !Array.isArray(data.peers)) return
    const online = new Set<string>()
    for (const item of data.peers) {
      if (!isRecord(item) || typeof item.ip !== 'string' || !item.ip) continue
      // 备机只认主机
      if (active.role === 'standby' && item.ip !== active.primaryIp) continue
      online.add(item.ip)
      const peer = this.peers.get(item.ip) ?? { ip: item.ip, link: 'down', hello: null, closedByPeer: false }
      this.peers.set(item.ip, peer)
      if (peer.link !== 'up') {
        peer.link = 'up'
        peer.closedByPeer = false
        void this.transport.send([peer.ip], this.hello(false))
      }
    }
    // 不在列表里的就是没连上：主机上去掉这台备机；备机上的主机留着，连过又断了显示断开，没连上过显示连接中
    for (const [ip, peer] of this.peers) {
      if (online.has(ip)) continue
      if (peer.link === 'up') {
        this.onPeerLost(peer)
        peer.link = 'down'
      }
      if (active.role === 'primary') this.peers.delete(ip)
    }
    this.emit()
  }

  /** HA|haRecv：data = [{ from, payload }]，按收到的顺序处理 */
  ingestHaRecv(result: CppAckResult | undefined): void {
    if (!this.active) return
    for (const item of result?.data ?? []) {
      if (!isRecord(item) || typeof item.from !== 'string') continue
      const message = parseHaMessage(item.payload)
      if (!message) continue
      this.handleMessage(item.from, message)
    }
  }

  private handleMessage(from: string, message: HaMessage): void {
    // 备机只认主机
    if (this.active?.role === 'standby' && from !== this.active.primaryIp) return
    switch (message.type) {
      case 'chunk':
        void this.transport.receiveChunk(from, message).then((whole) => {
          const restored = whole === null ? null : parseHaMessage(whole)
          if (restored && restored.type !== 'chunk' && restored.type !== 'chunk-ack') {
            this.handleMessage(from, restored)
          }
        })
        return
      case 'chunk-ack':
        this.transport.handleAck(from, message)
        return
      case 'hello':
        this.onHello(from, message)
        return
      case 'cmd':
        this.onCmd(from, message)
        return
      case 'model-file':
      case 'model-delete':
      case 'model-manifest':
      case 'model-request':
      case 'cover-file':
        void this.onFileMessage(from, message)
        return
      case 'app':
        // 工程同步由界面做：工程对得上才交给界面
        if (this.localProject && message.message.projectId === this.localProject.id) {
          this.deps.onAppMessage?.(from, message.message)
        }
        return
    }
  }

  /**
   * 界面发工程同步的消息：to 为 'all' 时发给所有能同步的另一台（主机上是这些备机，备机上是主机），
   * 否则只发给其中能同步的。大内容自动切块。
   */
  async postApp(to: string[] | 'all', message: HaAppMessage): Promise<boolean> {
    if (!this.active || !this.localProject || message.projectId !== this.localProject.id) return false
    const ready = this.syncTargets()
    const targets = to === 'all' ? ready : to.filter((ip) => ready.includes(ip))
    if (targets.length === 0) return false
    return this.transport.send(targets, message)
  }

  private onHello(from: string, hello: HaHelloMessage): void {
    const peer = this.peers.get(from) ?? { ip: from, link: 'up' as HaLinkState, hello: null, closedByPeer: false }
    this.peers.set(from, peer)
    peer.hello = hello
    peer.closedByPeer = hello.closing === true
    if (!hello.reply && !hello.closing) void this.transport.send([from], this.hello(true))
    this.emit()
  }

  /** 另一台执行的指令：工程对得上就带「不写 PLC」标志交给本机 C++（方案 6.3） */
  private onCmd(from: string, message: HaCmdMessage): void {
    if (!this.localProject || message.projectId !== this.localProject.id) return
    const envelope = toForwardEnvelope(message.envelope)
    for (const actionId of commandActionIds(envelope.params, envelope.paramHeard)) {
      this.actionOwners.set(actionId, 'peer')
    }
    void this.deps.csocket.sendForwarded(envelope).then((ack) => {
      if (!ack.success) this.log(`同步来的指令执行失败：${envelope.OptCmd} ${ack.message ?? ''}`)
    })
    // 多台备机：备机只连主机，备机之间的指令由主机转
    if (this.active?.role === 'primary') {
      const others = this.syncTargets().filter((ip) => ip !== from)
      if (others.length > 0) void this.transport.send(others, message)
    }
  }

  private onPeerLost(peer: PeerState): void {
    this.transport.dropPeer(peer.ip)
    if (this.active?.role === 'standby' && peer.ip === this.active.primaryIp) this.syncedProjectId = null
  }

  // ── 指令（CsocketApiService.sendBuilt 调） ──

  /**
   * 发出前（方案 6.1、6.4、6.5）：
   * - 备机：配置带标志；整台 PLC 的指令不能做；没核对完只能停止、急停（点动松开算停止）；
   * - 两台：另一台在用的设备不能操作（停止、急停除外）；主机上备机在用设备时不能做整台 PLC 的指令。
   */
  commandGate(optCmd: string, params?: unknown[]): HaCommandGate {
    const gate = this.evaluateGate(optCmd, params)
    if ('block' in gate) this.deps.onBlocked?.(optCmd, gate.block)
    return gate
  }

  private evaluateGate(optCmd: string, params?: unknown[]): HaCommandGate {
    const active = this.active
    if (!active || isHaLinkCommand(optCmd)) return { noPlc: false }
    const kind = classifyHaCommand(optCmd, params)
    if (active.role === 'standby') {
      if (kind === 'config') return { noPlc: true }
      if (kind === 'whole-plc') {
        return { block: '备机上不能做整台 PLC 的操作（复位、仿真、下载等），请到主机上操作' }
      }
      if (kind === 'write') {
        const gate = this.deviceGate()
        if (gate) return { block: gate }
      }
    } else if (kind === 'whole-plc' && this.peerBusy.size > 0) {
      const first = this.peerBusy.values().next().value as HaBusyEntry
      return { block: `${first.by} 正在操作设备，暂时不能做整台 PLC 的操作` }
    }
    if (kind === 'write' && this.peerBusy.size > 0) {
      for (const id of commandDeviceIds(params ?? [])) {
        const busy = this.peerBusy.get(id)
        if (busy) {
          // 「物体 6 正在由…」数字后空一格，「物体「吊杆」正在由…」不空
          const gap = /[0-9A-Za-z]$/.test(busy.label) ? ' ' : ''
          return { block: `${busy.label}${gap}正在由 ${busy.by} 操作` }
        }
      }
    }
    return { noPlc: false }
  }

  /** 界面按另一台的 status 算好在用的设备交过来；断开、关闭时交空的 */
  setPeerBusy(entries: HaBusyEntry[]): void {
    const next = new Map<number, HaBusyEntry>()
    for (const entry of entries) {
      if (Number.isInteger(entry.id) && typeof entry.label === 'string' && typeof entry.by === 'string') {
        next.set(entry.id, entry)
      }
    }
    this.peerBusy = this.active ? next : new Map()
  }

  /**
   * C++ 推来的 Info|act：最近一次由另一台准备、启动的动作不交给本机界面（方案 6.6），
   * 否则本机会给它补建任务卡、当成本机在运行。全被滤掉时返回 null。
   */
  filterActionReport(result: CppAckResult | undefined): CppAckResult | undefined | null {
    if (!this.active || !result || !Array.isArray(result.data)) return result
    const peerOwned = [...this.actionOwners].filter(([, owner]) => owner === 'peer')
    if (peerOwned.length === 0) return result
    const peerIds = new Set(peerOwned.map(([id]) => id))
    const data = result.data.filter((item) => {
      const actionId = isRecord(item) ? item.actionId : undefined
      return !(typeof actionId === 'number' && peerIds.has(actionId))
    })
    if (data.length === result.data.length) return result
    return data.length === 0 ? null : { ...result, data }
  }

  /**
   * 本机的指令发出（sent）、执行成功（acked）后调：停止类在发出时同步，其它在执行成功后同步。
   * 带「不写 PLC」标志的（备机的配置、另一台同步来的）不会走到这里。
   */
  onCommandSent(envelope: HaForwardEnvelope, stage: 'sent' | 'acked'): void {
    if (this.active && stage === 'sent') {
      for (const actionId of commandActionIds(envelope.params, envelope.paramHeard)) {
        this.actionOwners.set(actionId, 'local')
      }
    }
    if (!this.active || !this.localProject || !isHaSyncedCommand(envelope.OptCmd, envelope.params)) return
    const isStop = classifyHaCommand(envelope.OptCmd, envelope.params) === 'stop'
    if (isStop !== (stage === 'sent')) return
    const targets = this.syncTargets()
    if (targets.length === 0) return
    const message: HaCmdMessage = {
      type: 'cmd',
      projectId: this.localProject.id,
      envelope: toForwardEnvelope(envelope),
    }
    void this.transport.send(targets, message)
  }

  // ── 状态 ──

  /** 链路通着、热备消息版本一致、打开的是同一个工程（格式版本也一致）的另一台（主机上是这些备机，备机上是主机） */
  private syncTargets(): string[] {
    const local = this.localProject
    if (!local) return []
    return [...this.peers.values()]
      .filter(
        (peer) =>
          peer.link === 'up' &&
          peer.hello?.v === HA_MESSAGE_VERSION &&
          peer.hello.project?.id === local.id &&
          peer.hello.project.formatVersion === local.formatVersion &&
          !peer.closedByPeer,
      )
      .map((peer) => peer.ip)
  }

  private upPeers(): string[] {
    return [...this.peers.values()].filter((peer) => peer.link === 'up').map((peer) => peer.ip)
  }

  private hello(reply: boolean, closing = false): HaHelloMessage {
    const active = this.active
    return {
      type: 'hello',
      v: HA_MESSAGE_VERSION,
      hostName: active?.hostName ?? '',
      role: active?.role ?? 'primary',
      project: this.localProject,
      ...(reply ? { reply: true } : {}),
      ...(closing ? { closing: true } : {}),
    }
  }

  /** 备机除停止、急停外的设备操作被拦下的原因；null 表示不拦（方案 6.5） */
  private deviceGate(): string | null {
    const active = this.active
    if (!active || active.role !== 'standby') return null
    const primary = this.peers.get(active.primaryIp)
    if (!primary || primary.link !== 'up') return '与主机断开，只能停止、急停'
    const hello = primary.hello
    if (!hello) return '等待主机回应，只能停止、急停'
    if (primary.closedByPeer) return '主机已关闭热备，只能停止、急停'
    if (hello.v !== HA_MESSAGE_VERSION) return '两边软件的热备版本不一致，只能停止、急停'
    if (!this.localProject) return '本机没有打开工程，只能停止、急停'
    if (!hello.project) return '主机没有打开工程，只能停止、急停'
    if (hello.project.id !== this.localProject.id) return '和主机打开的不是同一个工程，只能停止、急停'
    if (hello.project.formatVersion !== this.localProject.formatVersion) {
      return '两边的工程格式版本不一致，只能停止、急停'
    }
    if (this.syncedProjectId !== this.localProject.id) return '还没和主机核对完成，只能停止、急停'
    return null
  }

  private toPeerView(peer: PeerState): HaPeerView {
    const up = peer.link === 'up'
    return {
      ip: peer.ip,
      link: peer.link,
      hostName: peer.hello?.hostName || null,
      role: peer.hello?.role ?? null,
      project: up ? (peer.hello?.project ?? null) : null,
      versionMismatch: up && peer.hello !== null && peer.hello.v !== HA_MESSAGE_VERSION,
      closedByPeer: peer.closedByPeer,
    }
  }

  getState(): HaState {
    const settings = this.settings ?? normalizeHaSettings(null, this.deps.defaultHostName)
    const active = this.active
    return {
      enabled: active !== null,
      role: active?.role ?? settings.role,
      hostName: active?.hostName ?? settings.hostName,
      localIp: active?.localIp ?? settings.localIp,
      primaryIp: active?.primaryIp ?? settings.primaryIp,
      syncScope: settings.syncScope,
      localProject: this.localProject,
      peers: [...this.peers.values()]
        .map((peer) => this.toPeerView(peer))
        .sort((a, b) => a.ip.localeCompare(b.ip)),
      deviceGate: this.deviceGate(),
      error: this.error,
    }
  }

  private emit(): void {
    const state = this.getState()
    const json = JSON.stringify(state)
    if (json === this.lastEmitted) return
    this.lastEmitted = json
    this.deps.onState(state)
  }

  dispose(): void {
    this.transport.dispose()
  }
}
