import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CppAckResult } from '../shared/csocket/types'
import { classifyHaCommand, isHaSyncedCommand } from '../shared/ha/command-class'
import { HA_MESSAGE_VERSION, parseHaMessage, type HaForwardEnvelope } from '../shared/ha/protocol'
import { normalizeHaSettings, validateHaSettings, type HaSettings, type HaState } from '../shared/ha/types'
import { modelBundleSha256, modelBundleSize, type HaModelBundle } from '../electron/main/ha/files'
import { HaService, type HaStartParams } from '../electron/main/ha/service'
import { HaTransport } from '../electron/main/ha/transport'
import { listLocalIpv4 } from '../electron/main/ha/storage'

const PROJECT = { id: 'p-1', name: '演出', formatVersion: 1 }

const primarySettings: HaSettings = {
  role: 'primary',
  hostName: '控台-A',
  localIp: '192.168.0.100',
  primaryIp: '',
  syncScope: { motion: true, rules: true, meta: true, models: true },
}

const standbySettings: HaSettings = {
  ...primarySettings,
  role: 'standby',
  hostName: '控台-B',
  localIp: '192.168.0.101',
  primaryIp: '192.168.0.100',
}

const createHarness = (settings: HaSettings, startAck: CppAckResult = { success: true }) => {
  const sent: { to: string[]; payload: Record<string, unknown> }[] = []
  const forwarded: HaForwardEnvelope[] = []
  const started: HaStartParams[] = []
  const states: HaState[] = []
  let stored: unknown = settings
  const service = new HaService({
    csocket: {
      haStart: vi.fn(async (params: HaStartParams) => {
        started.push(params)
        return startAck
      }),
      haStop: vi.fn(async () => ({ success: true })),
      haSend: vi.fn(async (to: string[], payload: unknown) => {
        sent.push({ to, payload: payload as Record<string, unknown> })
        return true
      }),
      sendForwarded: vi.fn(async (envelope: HaForwardEnvelope) => {
        forwarded.push(envelope)
        return { success: true }
      }),
    },
    storage: {
      load: async () => stored,
      save: async (next) => {
        stored = next
      },
    },
    defaultHostName: 'PC',
    onState: (state) => states.push(state),
  })
  // HA|info 只列连着的（没有 link 字段）：断开就是不在列表里
  const linkUp = (ip: string, link: 'up' | 'down' = 'up') =>
    service.ingestInfoHa({ success: true, data: [{ role: settings.role, peers: link === 'up' ? [{ ip }] : [] }] })
  const receive = (from: string, payload: unknown) =>
    service.ingestHaRecv({ success: true, data: [{ from, payload }] })
  const helloFrom = (from: string, project = PROJECT, extra: Record<string, unknown> = {}) =>
    receive(from, {
      type: 'hello',
      v: HA_MESSAGE_VERSION,
      hostName: from === '192.168.0.100' ? '控台-A' : '控台-B',
      role: from === '192.168.0.100' ? 'primary' : 'standby',
      project,
      reply: true,
      ...extra,
    })
  return { service, sent, forwarded, started, states, linkUp, receive, helloFrom }
}

const jog: HaForwardEnvelope = {
  OptCmd: 'Opera|jog',
  addr: '0x0104',
  params: [{ deviceId: 6, direction: 1 }],
  userName: 'operator',
}

describe('hot standby settings', () => {
  it('fills defaults and keeps valid fields', () => {
    expect(normalizeHaSettings(null, 'PC')).toEqual({
      role: 'primary',
      hostName: 'PC',
      localIp: '',
      primaryIp: '',
      syncScope: { motion: true, rules: true, meta: true, models: true },
    })
    expect(normalizeHaSettings({ role: 'standby', syncScope: { models: false } }, 'PC')).toMatchObject({
      role: 'standby',
      syncScope: { motion: true, models: false },
    })
  })

  it('validates what start needs', () => {
    expect(validateHaSettings(primarySettings)).toBeNull()
    expect(validateHaSettings({ ...primarySettings, localIp: '' })).toBe('请选择本机 IP')
    expect(validateHaSettings({ ...standbySettings, primaryIp: '192.168.0.300' })).toBe('请填写正确的主机 IP')
    expect(validateHaSettings({ ...standbySettings, primaryIp: '192.168.0.101' })).toBe('主机 IP 不能是本机 IP')
    expect(validateHaSettings({ ...primarySettings, hostName: ' ' })).toBe('请填写本机名称')
  })

  it('refuses to change role or IP while hot standby is on, but allows the sync scope', async () => {
    const { service } = createHarness(primarySettings)
    await service.start()
    const changedIp = await service.saveSettings({ ...primarySettings, localIp: '192.168.0.9' })
    expect(changedIp).toMatchObject({ ok: false, code: 'HA_ENABLED' })
    const changedScope = await service.saveSettings({
      ...primarySettings,
      syncScope: { ...primarySettings.syncScope, models: false },
    })
    expect(changedScope.ok).toBe(true)
  })

  it('lists external IPv4 addresses only', () => {
    expect(
      listLocalIpv4({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
        eth0: [
          { address: '192.168.0.100', family: 'IPv4', internal: false } as never,
          { address: 'fe80::1', family: 'IPv6', internal: false } as never,
        ],
      }),
    ).toEqual([{ address: '192.168.0.100', iface: 'eth0' }])
  })
})

describe('command classes', () => {
  it('sorts commands the way the plan does', () => {
    expect(classifyHaCommand('Opera|stop')).toBe('stop')
    expect(classifyHaCommand('Opera|actionCall')).toBe('stop')
    expect(classifyHaCommand('Config|axisParam')).toBe('config')
    expect(classifyHaCommand('CONFIG|DEV|addPlc')).toBe('config')
    expect(classifyHaCommand('CONFIG|Pro|download')).toBe('whole-plc')
    expect(classifyHaCommand('Information|projectVerify')).toBe('local')
    expect(classifyHaCommand('CONFIG|Pro|open')).toBe('local')
    expect(classifyHaCommand('HA|send')).toBe('local')
    expect(classifyHaCommand('Opera|jog')).toBe('write')
    expect(classifyHaCommand('Config2|actionDataSave')).toBe('write')
    // 点动松开（方向 0）是停止
    expect(classifyHaCommand('Opera|jog', [{ deviceId: 6, direction: 0 }])).toBe('stop')
    expect(classifyHaCommand('Opera|jog', [{ deviceId: 6, direction: 1 }])).toBe('write')
    expect(classifyHaCommand('Opera|jog', [{ deviceId: 6, direction: 0 }, { deviceId: 7, direction: 2 }])).toBe('write')
    expect(isHaSyncedCommand('Config|axisParam')).toBe(false)
    expect(isHaSyncedCommand('Opera|plcReset')).toBe(true)
  })
})

describe('HaService link', () => {
  it('starts with the role and local IP, and refuses invalid settings', async () => {
    const primary = createHarness(primarySettings)
    expect((await primary.service.start()).ok).toBe(true)
    expect(primary.started).toEqual([{ role: 'primary', ip: '192.168.0.100' }])

    const standby = createHarness(standbySettings)
    await standby.service.start()
    expect(standby.started).toEqual([{ role: 'standby', ip: '192.168.0.101', primaryIp: '192.168.0.100' }])
    expect(standby.service.getState().peers).toMatchObject([{ ip: '192.168.0.100', link: 'connecting' }])

    const broken = createHarness({ ...standbySettings, primaryIp: '' })
    expect(await broken.service.start()).toMatchObject({ ok: false, code: 'INVALID_SETTINGS' })
    expect(broken.started).toEqual([])
  })

  it('reports a C++ that does not answer HA|start', async () => {
    const { service } = createHarness(primarySettings, { success: false, code: 'SEND_FAILED' })
    const result = await service.start()
    expect(result).toMatchObject({ ok: false, code: 'START_FAILED' })
    expect(service.getState()).toMatchObject({ enabled: false })
    expect(service.getState().error).toContain('C++ 没有回应')
  })

  it('sends hello when a peer comes up and answers a hello once', async () => {
    const { service, sent, linkUp, receive } = createHarness(primarySettings)
    await service.start()
    service.setLocalProject(PROJECT)
    linkUp('192.168.0.101')
    expect(sent.at(-1)).toMatchObject({
      to: ['192.168.0.101'],
      payload: { type: 'hello', v: HA_MESSAGE_VERSION, hostName: '控台-A', role: 'primary', project: PROJECT },
    })
    expect(sent.at(-1)?.payload.reply).toBeUndefined()

    const before = sent.length
    receive('192.168.0.101', { type: 'hello', v: HA_MESSAGE_VERSION, hostName: '控台-B', role: 'standby', project: PROJECT })
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)?.payload).toMatchObject({ type: 'hello', reply: true })

    receive('192.168.0.101', { type: 'hello', v: HA_MESSAGE_VERSION, hostName: '控台-B', role: 'standby', project: PROJECT, reply: true })
    expect(sent.length).toBe(before + 1)
    expect(service.getState().peers).toMatchObject([
      { ip: '192.168.0.101', link: 'up', hostName: '控台-B', role: 'standby', project: PROJECT, versionMismatch: false },
    ])
  })

  it('re-sends hello to connected peers when the local project changes', async () => {
    const { service, sent, linkUp } = createHarness(primarySettings)
    await service.start()
    linkUp('192.168.0.101')
    const before = sent.length
    service.setLocalProject(PROJECT)
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)?.payload).toMatchObject({ type: 'hello', project: PROJECT })
    service.setLocalProject({ ...PROJECT })
    expect(sent.length).toBe(before + 1)
  })

  it('drops standbys that leave the list on the primary, keeps the primary as down on the standby', async () => {
    const primary = createHarness(primarySettings)
    await primary.service.start()
    primary.linkUp('192.168.0.101')
    primary.service.ingestInfoHa({ success: true, data: [{ role: 'primary', peers: [] }] })
    expect(primary.service.getState().peers).toEqual([])

    const standby = createHarness(standbySettings)
    await standby.service.start()
    standby.linkUp('192.168.0.100')
    standby.helloFrom('192.168.0.100')
    standby.service.ingestInfoHa({ success: true, data: [{ role: 'standby', peers: [] }] })
    expect(standby.service.getState().peers).toMatchObject([
      { ip: '192.168.0.100', link: 'down', hostName: '控台-A', project: null },
    ])
  })

  it('reads HA|info as the list of online peers and ignores any link field', async () => {
    const standby = createHarness(standbySettings)
    await standby.service.start()
    // 还没连上：主机不在列表里，显示连接中
    standby.service.ingestInfoHa({ success: true, data: [{ role: 'standby', peers: [] }] })
    expect(standby.service.getState().peers).toMatchObject([{ ip: '192.168.0.100', link: 'connecting' }])
    // 在列表里就是连着，带不带 link 都一样；备机上别的 IP 不认
    standby.service.ingestInfoHa({
      success: true,
      data: [{ role: 'standby', peers: [{ ip: '192.168.0.100', link: 'down' }, { ip: '192.168.0.77' }] }],
    })
    expect(standby.service.getState().peers).toMatchObject([{ ip: '192.168.0.100', link: 'up' }])
    expect(standby.sent.at(-1)).toMatchObject({ to: ['192.168.0.100'], payload: { type: 'hello' } })
    // 连过又不在列表里：断开
    standby.service.ingestInfoHa({ success: true, data: [{ role: 'standby', peers: [] }] })
    expect(standby.service.getState().peers).toMatchObject([{ ip: '192.168.0.100', link: 'down' }])
  })

  it('tells standbys before the primary closes hot standby', async () => {
    const { service, sent, linkUp } = createHarness(primarySettings)
    await service.start()
    linkUp('192.168.0.101')
    await service.stop()
    expect(sent.at(-1)).toMatchObject({ to: ['192.168.0.101'], payload: { type: 'hello', closing: true } })
    expect(service.getState()).toMatchObject({ enabled: false, peers: [] })
  })

  it('flags a version mismatch and does not count it as the same project', async () => {
    const { service, linkUp, helloFrom } = createHarness(standbySettings)
    await service.start()
    service.setLocalProject(PROJECT)
    linkUp('192.168.0.100')
    helloFrom('192.168.0.100', PROJECT, { v: HA_MESSAGE_VERSION + 1 })
    expect(service.getState().peers[0]).toMatchObject({ versionMismatch: true })
    expect(service.getState().deviceGate).toBe('两边软件的热备版本不一致，只能停止、急停')
  })

  it('re-sends HA|start after the local C++ reconnects', async () => {
    const { service, started, linkUp } = createHarness(primarySettings)
    await service.start()
    linkUp('192.168.0.101')
    service.onCsocketConnection('reconnecting')
    expect(service.getState().peers[0]).toMatchObject({ link: 'down' })
    service.onCsocketConnection('connected')
    expect(started).toHaveLength(2)
  })
})

describe('HaService standby gate', () => {
  const setup = async () => {
    const harness = createHarness(standbySettings)
    await harness.service.start()
    harness.service.setLocalProject(PROJECT)
    return harness
  }

  it('flags config commands and blocks whole-PLC commands on the standby', async () => {
    const { service } = await setup()
    expect(service.commandGate('Config|axisParam')).toEqual({ noPlc: true })
    expect(service.commandGate('CONFIG|DEV|addPlc')).toEqual({ noPlc: true })
    expect(service.commandGate('Opera|plcReset')).toHaveProperty('block')
    expect(service.commandGate('HA|send')).toEqual({ noPlc: false })
  })

  it('keeps stop and e-stop available and blocks other device commands until synced', async () => {
    const { service, linkUp, helloFrom } = await setup()
    expect(service.commandGate('Opera|stop')).toEqual({ noPlc: false })
    expect(service.commandGate('Opera|eStop')).toEqual({ noPlc: false })
    expect(service.commandGate('Opera|jog')).toEqual({ block: '与主机断开，只能停止、急停' })
    // 断线时点动松开不能拦
    expect(service.commandGate('Opera|jog', [{ deviceId: 6, direction: 0 }])).toEqual({ noPlc: false })

    linkUp('192.168.0.100')
    expect(service.commandGate('Opera|jog')).toEqual({ block: '等待主机回应，只能停止、急停' })
    helloFrom('192.168.0.100', { ...PROJECT, id: 'other' })
    expect(service.commandGate('Opera|jog')).toEqual({ block: '和主机打开的不是同一个工程，只能停止、急停' })
    helloFrom('192.168.0.100')
    expect(service.commandGate('Opera|jog')).toEqual({ block: '还没和主机核对完成，只能停止、急停' })
    service.setSynced(PROJECT.id)
    expect(service.commandGate('Opera|jog')).toEqual({ noPlc: false })
    expect(service.getState().deviceGate).toBeNull()

    linkUp('192.168.0.100', 'down')
    expect(service.commandGate('Opera|jog')).toEqual({ block: '与主机断开，只能停止、急停' })
    linkUp('192.168.0.100', 'up')
    helloFrom('192.168.0.100')
    // 断线后要重新核对
    expect(service.commandGate('Opera|jog')).toEqual({ block: '还没和主机核对完成，只能停止、急停' })
  })

  it('never gates the primary', async () => {
    const { service } = createHarness(primarySettings)
    await service.start()
    expect(service.commandGate('Opera|plcReset')).toEqual({ noPlc: false })
    expect(service.commandGate('Config|axisParam')).toEqual({ noPlc: false })
    expect(service.commandGate('Opera|jog')).toEqual({ noPlc: false })
  })
})

describe('HaService command sync', () => {
  const connectedPrimary = async () => {
    const harness = createHarness(primarySettings)
    await harness.service.start()
    harness.service.setLocalProject(PROJECT)
    harness.linkUp('192.168.0.101')
    harness.helloFrom('192.168.0.101')
    harness.sent.length = 0
    return harness
  }

  it('syncs a write command after it succeeds and a stop as soon as it is sent', async () => {
    const { service, sent } = await connectedPrimary()
    service.onCommandSent(jog, 'sent')
    expect(sent).toEqual([])
    service.onCommandSent(jog, 'acked')
    expect(sent).toEqual([
      { to: ['192.168.0.101'], payload: { type: 'cmd', projectId: PROJECT.id, envelope: jog } },
    ])

    sent.length = 0
    const release: HaForwardEnvelope = { OptCmd: 'Opera|jog', addr: '0x0104', params: [{ deviceId: 6, direction: 0 }] }
    service.onCommandSent(release, 'sent')
    expect(sent).toHaveLength(1)

    sent.length = 0
    const stop: HaForwardEnvelope = { OptCmd: 'Opera|stop', addr: '0x0108', params: [{ deviceId: 6 }] }
    service.onCommandSent(stop, 'sent')
    service.onCommandSent(stop, 'acked')
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toMatchObject({ type: 'cmd', envelope: { OptCmd: 'Opera|stop' } })
  })

  it('does not sync config, reads, or to a peer on another project', async () => {
    const { service, sent, helloFrom } = await connectedPrimary()
    service.onCommandSent({ OptCmd: 'Config|axisParam', addr: '0x0020', params: [] }, 'acked')
    service.onCommandSent({ OptCmd: 'Information|readModelInfo', addr: '', params: [] }, 'acked')
    expect(sent).toEqual([])
    helloFrom('192.168.0.101', { ...PROJECT, id: 'other' })
    service.onCommandSent(jog, 'acked')
    expect(sent).toEqual([])
  })

  it('hands a synced command to the local C++ with the flag and relays it to other standbys', async () => {
    const { service, sent, forwarded, linkUp, helloFrom, receive } = await connectedPrimary()
    linkUp('192.168.0.102')
    helloFrom('192.168.0.102')
    // linkUp only reported .102: keep .101 up as well
    service.ingestInfoHa({
      success: true,
      data: [{ role: 'primary', peers: [{ ip: '192.168.0.101' }, { ip: '192.168.0.102' }] }],
    })
    helloFrom('192.168.0.101')
    sent.length = 0

    receive('192.168.0.101', { type: 'cmd', projectId: PROJECT.id, envelope: { ...jog, messageId: 'x' } })
    expect(forwarded).toEqual([jog])
    expect(sent).toEqual([
      { to: ['192.168.0.102'], payload: { type: 'cmd', projectId: PROJECT.id, envelope: { ...jog, messageId: 'x' } } },
    ])
  })

  it('drops synced commands for another project', async () => {
    const { forwarded, receive } = await connectedPrimary()
    receive('192.168.0.101', { type: 'cmd', projectId: 'other', envelope: jog })
    expect(forwarded).toEqual([])
  })

  it('on the standby only accepts messages from the primary', async () => {
    const harness = createHarness(standbySettings)
    await harness.service.start()
    harness.service.setLocalProject(PROJECT)
    harness.receive('192.168.0.77', { type: 'cmd', projectId: PROJECT.id, envelope: jog })
    expect(harness.forwarded).toEqual([])
    harness.receive('192.168.0.100', { type: 'cmd', projectId: PROJECT.id, envelope: jog })
    expect(harness.forwarded).toEqual([jog])
  })
})

describe('HaTransport', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const pipe = (opts: { chunkChars: number; singleLimitBytes: number }) => {
    const wire: { from: string; to: string[]; payload: unknown }[] = []
    const received: unknown[] = []
    let a!: HaTransport
    let b!: HaTransport
    const deliver = async (from: string, to: string[], payload: unknown) => {
      wire.push({ from, to, payload })
      const target = from === 'A' ? b : a
      const message = parseHaMessage(payload)
      if (message?.type === 'chunk') {
        const whole = await target.receiveChunk(from, message)
        if (whole !== null) received.push(whole)
      } else if (message?.type === 'chunk-ack') {
        target.handleAck(from, message)
      } else {
        received.push(payload)
      }
      return true
    }
    a = new HaTransport((to, payload) => deliver('A', to, payload), opts)
    b = new HaTransport((to, payload) => deliver('B', to, payload), opts)
    return { a, b, wire, received }
  }

  it('sends small messages directly', async () => {
    const { a, wire, received } = pipe({ chunkChars: 64, singleLimitBytes: 1024 })
    expect(await a.send(['B'], { type: 'hello', v: 1 })).toBe(true)
    expect(wire).toHaveLength(1)
    expect(received).toEqual([{ type: 'hello', v: 1 }])
  })

  it('chunks a large message, waits for each ack and restores it', async () => {
    const { a, wire, received } = pipe({ chunkChars: 64, singleLimitBytes: 256 })
    const big = { type: 'full', data: Array.from({ length: 400 }, (_, i) => `工程-${i}-${Math.random()}`) }
    expect(await a.send(['B'], big)).toBe(true)
    const chunks = wire.filter((item) => (item.payload as { type: string }).type === 'chunk')
    const acks = wire.filter((item) => (item.payload as { type: string }).type === 'chunk-ack')
    expect(chunks.length).toBeGreaterThan(1)
    expect(acks).toHaveLength(chunks.length)
    expect(received).toEqual([big])
    expect(a.pendingCounts()).toEqual({ acks: 0, incoming: 0 })
  })

  it('fails a transfer when the peer drops', async () => {
    const sent: unknown[] = []
    const transport = new HaTransport(
      async (_to, payload) => {
        sent.push(payload)
        return true
      },
      { chunkChars: 16, singleLimitBytes: 32, ackTimeoutMs: 60_000 },
    )
    const sending = transport.send(['B'], { type: 'full', data: 'x'.repeat(5000) + Math.random() })
    await vi.waitFor(() => expect(sent.length).toBe(1))
    transport.dropPeer('B')
    expect(await sending).toBe(false)
    expect(transport.pendingCounts()).toEqual({ acks: 0, incoming: 0 })
  })
})

describe('HaService busy devices and action reports', () => {
  const connected = async (settings: HaSettings) => {
    const harness = createHarness(settings)
    await harness.service.start()
    harness.service.setLocalProject(PROJECT)
    const peer = settings.role === 'primary' ? '192.168.0.101' : '192.168.0.100'
    harness.linkUp(peer)
    harness.helloFrom(peer)
    if (settings.role === 'standby') harness.service.setSynced(PROJECT.id)
    return harness
  }

  it('blocks writes to devices the other side is using, but never stops', async () => {
    const { service } = await connected(primarySettings)
    service.setPeerBusy([{ id: 6, label: '物体「吊杆」', by: '控台-B' }])
    expect(service.commandGate('Opera|jog', [{ deviceId: 6, direction: 1 }])).toEqual({
      block: '物体「吊杆」正在由 控台-B 操作',
    })
    expect(service.commandGate('Opera|jog', [{ deviceId: 7, direction: 1 }])).toEqual({ noPlc: false })
    expect(service.commandGate('Opera|jog', [{ deviceId: 6, direction: 0 }])).toEqual({ noPlc: false })
    expect(service.commandGate('Opera|stop', [{ deviceId: 6 }])).toEqual({ noPlc: false })
    // 动作指令里的设备列表也认
    expect(service.commandGate('Opera|actionSyncRelease', [{ actionId: 3, deviceId: [5, 6] }])).toHaveProperty('block')
    expect(service.commandGate('Opera|syncMovePrepare', [{ actionId: 3, modelList: [{ deviceId: 6 }] }])).toHaveProperty('block')
  })

  it('blocks whole-PLC commands on the primary while a standby uses devices', async () => {
    const { service } = await connected(primarySettings)
    expect(service.commandGate('Opera|plcReset', [{ deviceId: 1 }])).toEqual({ noPlc: false })
    service.setPeerBusy([{ id: 6, label: '物体 6', by: '控台-B' }])
    expect(service.commandGate('Opera|plcReset', [{ deviceId: 1 }])).toEqual({
      block: '控台-B 正在操作设备，暂时不能做整台 PLC 的操作',
    })
    service.setPeerBusy([])
    expect(service.commandGate('Opera|plcReset', [{ deviceId: 1 }])).toEqual({ noPlc: false })
  })

  it('reports blocked commands and forgets busy devices when hot standby stops', async () => {
    const blocked: string[] = []
    const harness = createHarness(primarySettings)
    // 用同一套 csocket，换一个带 onBlocked 的服务
    const service = new HaService({
      csocket: {
        haStart: async () => ({ success: true }),
        haStop: async () => ({ success: true }),
        haSend: async () => true,
        sendForwarded: async () => ({ success: true }),
      },
      storage: { load: async () => primarySettings, save: async () => undefined },
      defaultHostName: 'PC',
      onState: () => undefined,
      onBlocked: (_optCmd, reason) => blocked.push(reason),
    })
    void harness
    await service.start()
    service.setPeerBusy([{ id: 6, label: '物体 6', by: '控台-B' }])
    service.commandGate('Opera|moveTarget', [{ deviceId: 6 }])
    expect(blocked).toEqual(['物体 6 正在由 控台-B 操作'])
    await service.stop()
    expect(service.commandGate('Opera|moveTarget', [{ deviceId: 6 }])).toEqual({ noPlc: false })
  })

  it('drops Info|act reports for actions the other side started', async () => {
    const { service, receive } = await connected(primarySettings)
    const report = (ids: number[]) => ({ success: true, data: ids.map((actionId) => ({ actionId, state: 3 })) })
    expect(service.filterActionReport(report([3]))).toEqual(report([3]))
    receive('192.168.0.101', {
      type: 'cmd',
      projectId: PROJECT.id,
      envelope: { OptCmd: 'Opera|syncMovePrepare', addr: '0x010A', params: [{ actionId: 3, modelList: [] }] },
    })
    expect(service.filterActionReport(report([3]))).toBeNull()
    expect(service.filterActionReport(report([3, 4]))).toEqual(report([4]))
    // 本机再准备同一个动作，就算本机的
    service.onCommandSent({ OptCmd: 'Opera|syncMovePrepare', addr: '0x010A', params: [{ actionId: 3 }] }, 'sent')
    expect(service.filterActionReport(report([3]))).toEqual(report([3]))
  })
})

describe('HaService model and cover files', () => {
  type Files = Map<string, Buffer>
  const filesPort = (files: Files, cover: { fileName: string; data: Buffer } | null = null) => {
    const state = { cover, writes: [] as string[], deletes: [] as string[] }
    const assets = new Map<string, HaModelBundle['assets']>()
    const bundleOf = (name: string): HaModelBundle | null => {
      const data = files.get(name)
      return data ? { data, assets: assets.get(name) ?? [] } : null
    }
    return {
      state,
      assets,
      port: {
        listModels: async () =>
          [...files.keys()]
            .map((name) => {
              const bundle = bundleOf(name)!
              return { name, sha256: modelBundleSha256(bundle), size: modelBundleSize(bundle) }
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        readModel: async (name: string) => bundleOf(name),
        writeModel: async (name: string, bundle: HaModelBundle, sha256: string) => {
          if (modelBundleSha256(bundle) !== sha256) return false
          files.set(name, bundle.data)
          if (bundle.assets.length > 0) assets.set(name, bundle.assets)
          else assets.delete(name)
          state.writes.push(name)
          return true
        },
        deleteModel: async (name: string) => {
          files.delete(name)
          assets.delete(name)
          state.deletes.push(name)
        },
        readCover: async () => state.cover,
        writeCover: async (fileName: string, data: Buffer) => {
          state.cover = { fileName, data }
          return true
        },
      },
    }
  }

  /** 两个服务接在一起：一台的 haSend 直接交给另一台的 HA|haRecv */
  const pair = async (primaryFiles: Files, standbyFiles: Files, primaryCover: { fileName: string; data: Buffer } | null = null) => {
    let primary!: HaService
    let standby!: HaService
    const deliver = (from: string, to: HaService) => async (_to: string[], payload: unknown) => {
      await Promise.resolve()
      to.ingestHaRecv({ success: true, data: [{ from, payload }] })
      return true
    }
    const changed = { primary: 0, standby: 0 }
    const pf = filesPort(primaryFiles, primaryCover)
    const sf = filesPort(standbyFiles)
    const make = (settings: HaSettings, files: ReturnType<typeof filesPort>, send: () => (to: string[], p: unknown) => Promise<boolean>, key: 'primary' | 'standby') =>
      new HaService({
        csocket: {
          haStart: async () => ({ success: true }),
          haStop: async () => ({ success: true }),
          haSend: (to, payload) => send()(to, payload),
          sendForwarded: async () => ({ success: true }),
        },
        storage: { load: async () => settings, save: async () => undefined },
        defaultHostName: 'PC',
        onState: () => undefined,
        files: files.port,
        onModelsChanged: () => {
          changed[key] += 1
        },
      })
    primary = make(primarySettings, pf, () => deliver('192.168.0.100', standby), 'primary')
    standby = make(standbySettings, sf, () => deliver('192.168.0.101', primary), 'standby')
    await primary.start()
    await standby.start()
    primary.setLocalProject(PROJECT)
    standby.setLocalProject(PROJECT)
    primary.ingestInfoHa({ success: true, data: [{ role: 'primary', peers: [{ ip: '192.168.0.101' }] }] })
    standby.ingestInfoHa({ success: true, data: [{ role: 'standby', peers: [{ ip: '192.168.0.100' }] }] })
    await vi.waitFor(() => expect(primary.getState().peers[0]?.project).toEqual(PROJECT))
    await vi.waitFor(() => expect(standby.getState().peers[0]?.project).toEqual(PROJECT))
    standby.setSynced(PROJECT.id, { motion: true, rules: true, meta: true, models: true })
    return { primary, standby, pf, sf, changed }
  }

  it('fills missing files both ways and uses the chosen side for conflicts', async () => {
    const primaryFiles: Files = new Map([['a.glb', Buffer.from('A')], ['same.glb', Buffer.from('P')]])
    const standbyFiles: Files = new Map([['b.glb', Buffer.from('B')], ['same.glb', Buffer.from('S')]])
    const { standby, changed } = await pair(primaryFiles, standbyFiles)
    await standby.syncModels('primary')
    // 一个一个传：等同名的那个也到了再比
    await vi.waitFor(() => expect(standbyFiles.get('same.glb')?.toString()).toBe('P'))
    await vi.waitFor(() => expect([...standbyFiles.keys()].sort()).toEqual(['a.glb', 'b.glb', 'same.glb']))
    await vi.waitFor(() => expect([...primaryFiles.keys()].sort()).toEqual(['a.glb', 'b.glb', 'same.glb']))
    expect(primaryFiles.get('same.glb')?.toString()).toBe('P')
    expect(changed.standby).toBeGreaterThan(0)
  })

  it('keeps the standby version when the user picked the standby content', async () => {
    const primaryFiles: Files = new Map([['same.glb', Buffer.from('P')]])
    const standbyFiles: Files = new Map([['same.glb', Buffer.from('S')]])
    const { standby } = await pair(primaryFiles, standbyFiles)
    await standby.syncModels('standby')
    await vi.waitFor(() => expect(primaryFiles.get('same.glb')?.toString()).toBe('S'))
    expect(standbyFiles.get('same.glb')?.toString()).toBe('S')
  })

  it('sends imports, deletes and the saved cover', async () => {
    const primaryFiles: Files = new Map()
    const standbyFiles: Files = new Map()
    const { primary, standby, sf } = await pair(primaryFiles, standbyFiles, { fileName: 'cover.png', data: Buffer.from('png') })
    standbyFiles.set('new.glb', Buffer.from('N'))
    standby.onProjectFileEvent({ kind: 'model-import', projectName: PROJECT.name, fileName: 'new.glb' })
    await vi.waitFor(() => expect(primaryFiles.get('new.glb')?.toString()).toBe('N'))
    primary.onProjectFileEvent({ kind: 'model-delete', projectName: PROJECT.name, fileName: 'new.glb' })
    primaryFiles.delete('new.glb')
    await vi.waitFor(() => expect(standbyFiles.has('new.glb')).toBe(false))
    primary.onProjectFileEvent({ kind: 'saved', projectName: PROJECT.name, coverWritten: true })
    await vi.waitFor(() => expect(sf.state.cover?.data.toString()).toBe('png'))
  })

  it('sends an OBJ with its material and textures as one bundle', async () => {
    const primaryFiles: Files = new Map()
    const standbyFiles: Files = new Map()
    const { primary, standby, pf, sf } = await pair(primaryFiles, standbyFiles)
    const textured = [
      { name: 'box.mtl', data: Buffer.from('newmtl m\nmap_kd wood.png') },
      { name: 'wood.png', data: Buffer.from('png') },
    ]
    standbyFiles.set('box.obj', Buffer.from('mtllib box.mtl'))
    sf.assets.set('box.obj', textured)
    standby.onProjectFileEvent({ kind: 'model-import', projectName: PROJECT.name, fileName: 'box.obj' })
    await vi.waitFor(() => expect(primaryFiles.get('box.obj')?.toString()).toBe('mtllib box.mtl'))
    expect(pf.assets.get('box.obj')?.map((asset) => [asset.name, asset.data.toString()])).toEqual([
      ['box.mtl', 'newmtl m\nmap_kd wood.png'],
      ['wood.png', 'png'],
    ])

    // 只换了贴图也算不同：核对时按整包摘要比
    pf.assets.set('box.obj', [textured[0], { name: 'wood.png', data: Buffer.from('png-2') }])
    await standby.syncModels('primary')
    await vi.waitFor(() => expect(sf.assets.get('box.obj')?.[1]?.data.toString()).toBe('png-2'))

    primary.onProjectFileEvent({ kind: 'model-delete', projectName: PROJECT.name, fileName: 'box.obj' })
    await vi.waitFor(() => expect(sf.assets.has('box.obj')).toBe(false))
    expect(standbyFiles.has('box.obj')).toBe(false)
  })

  it('drops a model bundle with an unsafe asset name', () => {
    const message = {
      type: 'model-file',
      projectId: PROJECT.id,
      name: 'box.obj',
      sha256: 'x',
      data: '',
      assets: [{ name: '../evil.png', data: '' }],
    }
    expect(parseHaMessage(message)).toBeNull()
    expect(parseHaMessage({ ...message, assets: [{ name: 'wood.png', data: '' }] })).not.toBeNull()
  })

  it('does not sync files when models are out of scope', async () => {
    const primaryFiles: Files = new Map([['a.glb', Buffer.from('A')]])
    const standbyFiles: Files = new Map()
    const { standby } = await pair(primaryFiles, standbyFiles)
    standby.setSynced(PROJECT.id, { motion: true, rules: true, meta: true, models: false })
    await standby.syncModels('primary')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(standbyFiles.size).toBe(0)
  })
})
