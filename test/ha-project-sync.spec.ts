import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { HaAppMessage } from '../shared/ha/protocol'
import { extractSyncItems, syncDigestSource } from '../shared/ha/sync-items'
import { DEFAULT_HA_SYNC_SCOPE, type HaRole, type HaState, type HaSyncRecord } from '../shared/ha/types'
import { HaProjectSync, type HaSyncPorts } from '../src/app/hot-standby/ha-project-sync'

const PROJECT = { id: 'p-1', name: '演出', formatVersion: 1 }
const PRIMARY = '192.168.0.100'
const STANDBY = '192.168.0.101'
const STANDBY2 = '192.168.0.102'

type Doc = ReturnType<typeof baseDoc>

const baseDoc = () => ({
  schemaVersion: '1',
  meta: { id: PROJECT.id, name: PROJECT.name, author: '张三', wizard: {}, createdAt: 'c', modifiedAt: 'm' },
  setup: {
    plcs: [{ id: 1, ip: '192.168.1.10' }],
    motors: [{ id: 61, plcId: 1 }],
    controlledObjects: [
      { id: 6, name: '吊杆' },
      { id: 7, name: '升降台' },
    ],
    alignment: {},
  },
  motion: { actionSequences: [{ id: 12, name: '开场', blocks: [] }], programs: [] },
  rules: { rules: [] },
  view: {},
  snapshots: [],
})

const renameObject = (doc: Doc, id: number, name: string): Doc => ({
  ...doc,
  setup: {
    ...doc.setup,
    controlledObjects: doc.setup.controlledObjects.map((object) => (object.id === id ? { ...object, name } : object)),
  },
})

type Side = {
  ip: string
  doc: Doc
  locked: string | null
  dirty: boolean
  sync: HaProjectSync
  notices: string[]
  synced: (string | null)[]
  backups: number
  writes: number
  saves: number
  reopens: number
  modelSyncs: string[]
  lastWrite: Record<string, unknown> | null
  records: Map<string, HaSyncRecord>
}

const digestOf = (doc: Doc) =>
  createHash('sha256').update(syncDigestSource(extractSyncItems(doc, DEFAULT_HA_SYNC_SCOPE))).digest('hex')

const createNet = () => {
  const queue: { from: string; to: string[]; message: HaAppMessage }[] = []
  const sides = new Map<string, Side>()
  let clock = 1_000_000

  const add = (ip: string, doc: Doc): Side => {
    const side = {
      ip,
      doc,
      locked: null,
      dirty: false,
      notices: [],
      synced: [],
      backups: 0,
      writes: 0,
      saves: 0,
      reopens: 0,
      modelSyncs: [],
      lastWrite: null,
      records: new Map(),
    } as unknown as Side
    const ports: HaSyncPorts = {
      getDocument: () => side.doc as never,
      applyRemote: (updater, options) => {
        if (options.check && side.locked) return { ok: false, changed: false, reason: side.locked }
        const next = updater(side.doc as never) as unknown as Doc
        if (next === side.doc) return { ok: true, changed: false }
        side.doc = next
        side.dirty = true
        side.sync.onLocalDocument(options.reopen ? 'version-restore' : 'remote', false)
        return { ok: true, changed: true }
      },
      reopenCpp: async () => {
        side.reopens += 1
      },
      markSaved: () => {
        side.dirty = false
      },
      isDirty: () => side.dirty,
      post: async (to, message) => {
        const targets = to === 'all' ? [...sides.keys()].filter((key) => key !== ip) : to
        queue.push({ from: ip, to: targets, message: structuredClone(message) })
        return true
      },
      setSynced: (projectId) => {
        side.synced.push(projectId)
      },
      syncModels: (prefer) => {
        side.modelSyncs.push(prefer)
      },
      writeSynced: async (parts) => {
        side.writes += 1
        side.lastWrite = parts as Record<string, unknown>
      },
      backup: async () => {
        side.backups += 1
        return true
      },
      getRecord: async (projectId) => side.records.get(projectId) ?? null,
      setRecord: async (projectId, record) => {
        if (record) side.records.set(projectId, record)
        else side.records.delete(projectId)
      },
      saveOnRequest: async () => {
        side.saves += 1
        side.dirty = false
        side.sync.onLocalSaved()
      },
      digest: async (text) => createHash('sha256').update(text).digest('hex'),
      notify: (text) => {
        side.notices.push(text)
      },
      now: () => clock,
      setTimer: (fn) => {
        fn()
        return () => undefined
      },
    }
    side.sync = new HaProjectSync(ports)
    sides.set(ip, side)
    return side
  }

  const settle = async () => {
    for (let round = 0; round < 500; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const next = queue.shift()
      if (!next) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (queue.length === 0) return
        continue
      }
      for (const to of next.to) sides.get(to)?.sync.onMessage(next.from, next.message)
    }
    throw new Error('network did not settle')
  }

  const state = (role: HaRole, self: string, peers: string[]): HaState => ({
    enabled: true,
    role,
    hostName: role === 'primary' ? '控台-A' : `控台-${self.slice(-1)}`,
    localIp: self,
    primaryIp: role === 'standby' ? PRIMARY : '',
    syncScope: DEFAULT_HA_SYNC_SCOPE,
    localProject: PROJECT,
    peers: peers.map((ip) => ({
      ip,
      link: 'up',
      hostName: ip === PRIMARY ? '控台-A' : `控台-${ip.slice(-1)}`,
      role: ip === PRIMARY ? 'primary' : 'standby',
      project: PROJECT,
      versionMismatch: false,
      closedByPeer: false,
    })),
    deviceGate: null,
    error: null,
  })

  const edit = async (side: Side, change: (doc: Doc) => Doc, settleAfter = true) => {
    side.doc = change(side.doc)
    side.dirty = true
    side.sync.onLocalDocument('setup', false)
    if (settleAfter) await settle()
  }

  return {
    add,
    settle,
    state,
    edit,
    queue,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

const connect = async (net: ReturnType<typeof createNet>, primary: Side, standbys: Side[]) => {
  primary.sync.updateHaState(net.state('primary', PRIMARY, standbys.map((side) => side.ip)))
  for (const standby of standbys) standby.sync.updateHaState(net.state('standby', standby.ip, [PRIMARY]))
  await net.settle()
}

describe('HaProjectSync reconcile', () => {
  it('marks the standby synced when both sides are the same', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const standby = net.add(STANDBY, baseDoc())
    await connect(net, primary, [standby])
    expect(standby.sync.getSnapshot().phase).toBe('synced')
    expect(standby.synced.at(-1)).toBe(PROJECT.id)
    expect(primary.sync.getSnapshot().standbys).toEqual({ [STANDBY]: 'synced' })
    expect(standby.backups).toBe(0)
    expect(standby.records.get(PROJECT.id)?.digest).toBe(digestOf(baseDoc()))
    expect(standby.modelSyncs).toEqual(['primary'])
  })

  it('takes the primary content without asking when the standby did not change since the last sync', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, renameObject(baseDoc(), 6, '吊杆（主机改）'))
    const standby = net.add(STANDBY, baseDoc())
    standby.records.set(PROJECT.id, { digest: digestOf(baseDoc()), dirty: false, at: 'x' })
    await connect(net, primary, [standby])
    expect(standby.sync.getSnapshot()).toMatchObject({ phase: 'synced', confirm: null })
    expect(standby.doc.setup.controlledObjects[0].name).toBe('吊杆（主机改）')
    expect(standby.backups).toBe(1)
    expect(standby.writes).toBeGreaterThan(0)
    // 配置变了：写盘后让 C++ 重新打开工程
    expect(standby.reopens).toBe(1)
    // 重新载入不算本机的修改，不会发回主机
    await net.settle()
    expect(primary.doc.setup.controlledObjects[0].name).toBe('吊杆（主机改）')
  })

  it('asks when there is no record, and pushes the standby content when the user picks it', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const standby = net.add(STANDBY, renameObject(baseDoc(), 7, '升降台（备机改）'))
    await connect(net, primary, [standby])
    expect(standby.sync.getSnapshot()).toMatchObject({
      phase: 'confirm',
      confirm: { primaryName: '控台-A', noRecord: true },
    })
    expect(primary.sync.getSnapshot().standbys).toEqual({ [STANDBY]: 'confirm' })

    standby.sync.resolveConfirm('local')
    await net.settle()
    // 选了用本机的：模型文件同名不同内容也用备机的
    expect(standby.modelSyncs).toEqual(['standby'])
    expect(primary.doc.setup.controlledObjects[1].name).toBe('升降台（备机改）')
    expect(primary.backups).toBe(1)
    expect(standby.sync.getSnapshot().phase).toBe('synced')
    expect(primary.sync.getSnapshot().standbys).toEqual({ [STANDBY]: 'synced' })
  })

  it('asks when the record has unsaved changes even if the standby did not change', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, renameObject(baseDoc(), 6, '旧'))
    const standby = net.add(STANDBY, baseDoc())
    standby.records.set(PROJECT.id, { digest: digestOf(baseDoc()), dirty: true, at: 'x' })
    await connect(net, primary, [standby])
    expect(standby.sync.getSnapshot().confirm).toMatchObject({ unsavedOnRecord: true, standbyChanged: false })
    standby.sync.resolveConfirm('primary')
    await net.settle()
    expect(standby.doc.setup.controlledObjects[0].name).toBe('旧')
    expect(standby.sync.getSnapshot().phase).toBe('synced')
  })
})

describe('HaProjectSync daily changes', () => {
  const syncedPair = async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const standby = net.add(STANDBY, baseDoc())
    await connect(net, primary, [standby])
    return { net, primary, standby }
  }

  it('sends a standby edit to the primary, which applies it and sends it back', async () => {
    const { net, primary, standby } = await syncedPair()
    await net.edit(standby, (doc) => renameObject(doc, 6, '吊杆 B'))
    expect(primary.doc.setup.controlledObjects[0].name).toBe('吊杆 B')
    expect(primary.dirty).toBe(true)
    expect(digestOf(primary.doc)).toBe(digestOf(standby.doc))
    expect(standby.notices).toEqual([])
  })

  it('sends a primary edit to the standby and writes it to disk there', async () => {
    const { net, primary, standby } = await syncedPair()
    const writes = standby.writes
    const remote: { keys: string[]; byName: string }[] = []
    standby.sync.onRemoteChange((event) => remote.push(event))
    await net.edit(primary, (doc) => ({ ...doc, setup: { ...doc.setup, motors: [] } }))
    expect(standby.doc.setup.motors).toEqual([])
    expect(standby.writes).toBeGreaterThan(writes)
    expect(remote).toEqual([{ keys: ['setup:motor:61'], byName: '控台-A' }])
  })

  it('lets the later arrival win and tells the overwritten side', async () => {
    const { net, primary, standby } = await syncedPair()
    // 主机先改并发出，备机在收到之前也改了同一个物体
    await net.edit(primary, (doc) => renameObject(doc, 6, '主机的名字'), false)
    await net.edit(standby, (doc) => renameObject(doc, 6, '备机的名字'), false)
    await net.settle()
    expect(primary.doc.setup.controlledObjects[0].name).toBe('备机的名字')
    expect(standby.doc.setup.controlledObjects[0].name).toBe('备机的名字')
    // 备机的修改还在路上时收到主机的不提示；主机自己刚改的被覆盖，提示
    expect(standby.notices).toEqual([])
    expect(primary.notices).toEqual(['「备机的名字」被 控台-1 改了'])
  })

  it('bounces a change the primary cannot apply and restores the primary content on the standby', async () => {
    const { net, primary, standby } = await syncedPair()
    primary.locked = '轴运动中，搭建只读'
    await net.edit(standby, (doc) => renameObject(doc, 6, '改不了'))
    expect(primary.doc.setup.controlledObjects[0].name).toBe('吊杆')
    expect(standby.doc.setup.controlledObjects[0].name).toBe('吊杆')
    expect(standby.notices).toEqual(['修改被主机退回：轴运动中，搭建只读'])
  })

  it('tells the standby when the primary saves, and asks the primary to save when the standby does', async () => {
    const { net, primary, standby } = await syncedPair()
    await net.edit(primary, (doc) => renameObject(doc, 7, '保存前'))
    expect(standby.dirty).toBe(true)
    primary.dirty = false
    primary.doc = { ...primary.doc, view: { camera: '主机的视角' } }
    primary.sync.onLocalSaved()
    await net.settle()
    expect(standby.dirty).toBe(false)
    // 主机保存时的视角写进备机的 project.json
    expect(standby.lastWrite).toMatchObject({ view: { camera: '主机的视角' } })

    standby.sync.onLocalSaved()
    await net.settle()
    expect(primary.saves).toBe(1)
  })

  it('records the agreed content when the link drops', async () => {
    const { net, primary, standby } = await syncedPair()
    await net.edit(primary, (doc) => renameObject(doc, 7, '断线前'))
    standby.sync.updateHaState({ ...net.state('standby', STANDBY, [PRIMARY]), peers: [] })
    await net.settle()
    expect(standby.sync.getSnapshot().phase).toBe('idle')
    expect(standby.synced.at(-1)).toBeNull()
    expect(standby.records.get(PROJECT.id)).toMatchObject({ digest: digestOf(standby.doc), dirty: true })
  })
})

describe('HaProjectSync first check', () => {
  it('does not lose a primary edit made while the first standby is still checking', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const standby = net.add(STANDBY, baseDoc())
    primary.sync.updateHaState(net.state('primary', PRIMARY, [STANDBY]))
    standby.sync.updateHaState(net.state('standby', STANDBY, [PRIMARY]))
    // 备机的请求到主机、主机回了 sync-hello 之后，备机核对完之前，主机改了东西
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    const request = net.queue.shift()
    expect(request?.message).toMatchObject({ type: 'sync-hello', state: 'checking' })
    primary.sync.onMessage(request!.from, request!.message)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await net.edit(primary, (doc) => renameObject(doc, 6, '核对中改的'), false)
    await net.settle()
    expect(standby.sync.getSnapshot().phase).toBe('synced')
    expect(standby.doc.setup.controlledObjects[0].name).toBe('核对中改的')
  })
})

describe('HaProjectSync with two standbys', () => {
  it('relays a standby edit to the other standby and catches up one that was still checking', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const first = net.add(STANDBY, baseDoc())
    await connect(net, primary, [first])

    // 第二台连上，核对还没完成时第一台改了东西
    const second = net.add(STANDBY2, baseDoc())
    primary.sync.updateHaState(net.state('primary', PRIMARY, [STANDBY, STANDBY2]))
    second.sync.updateHaState(net.state('standby', STANDBY2, [PRIMARY]))
    await net.edit(first, (doc) => renameObject(doc, 7, '第一台改的'), false)
    await net.settle()

    expect(primary.doc.setup.controlledObjects[1].name).toBe('第一台改的')
    expect(second.doc.setup.controlledObjects[1].name).toBe('第一台改的')
    expect(second.sync.getSnapshot().phase).toBe('synced')
    expect(digestOf(second.doc)).toBe(digestOf(primary.doc))
  })
})

describe('HaProjectSync in-use status', () => {
  it('exchanges what each side is using and relays standbys to each other', async () => {
    const net = createNet()
    const primary = net.add(PRIMARY, baseDoc())
    const first = net.add(STANDBY, baseDoc())
    const second = net.add(STANDBY2, baseDoc())
    await connect(net, primary, [first, second])
    primary.sync.updateHaState(net.state('primary', PRIMARY, [STANDBY, STANDBY2]))
    await net.settle()

    first.sync.setLocalStatus({ deviceIds: [6], sequenceIds: [12] })
    await net.settle()
    // 每台备机同步后都报一次（空的也报）
    expect(primary.sync.getSnapshot().peerHolders).toEqual([
      { name: '控台-1', deviceIds: [6], sequenceIds: [12] },
      { name: '控台-2', deviceIds: [], sequenceIds: [] },
    ])
    expect(second.sync.getSnapshot().peerHolders).toEqual([
      { name: '控台-A', deviceIds: [], sequenceIds: [] },
      { name: '控台-1', deviceIds: [6], sequenceIds: [12] },
    ])

    primary.sync.setLocalStatus({ deviceIds: [7], sequenceIds: [] })
    await net.settle()
    expect(first.sync.getSnapshot().peerHolders).toEqual([
      { name: '控台-A', deviceIds: [7], sequenceIds: [] },
      { name: '控台-2', deviceIds: [], sequenceIds: [] },
    ])

    // 第一台断开：主机和第二台都不再算它在用
    primary.sync.updateHaState(net.state('primary', PRIMARY, [STANDBY2]))
    await net.settle()
    expect(primary.sync.getSnapshot().peerHolders).toEqual([{ name: '控台-2', deviceIds: [], sequenceIds: [] }])
    expect(second.sync.getSnapshot().peerHolders).toEqual([{ name: '控台-A', deviceIds: [7], sequenceIds: [] }])
  })
})
