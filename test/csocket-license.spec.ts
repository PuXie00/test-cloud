import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildEnvelopeInput, CppAckResult, CppEnvelope, CsocketResult, CsocketSendOpts2 } from '../shared/csocket/types'
import { CSOCKET_CHANNELS } from '../shared/csocket/channels'
import { LicenseStore, licenseStateOf, toLicenseInfo, type LicenseAck } from '../shared/csocket/license'

const electron = vi.hoisted(() => ({ isPackaged: false, pushed: [] as [string, unknown][] }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.isPackaged
    },
    getPath: () => '',
  },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (channel: string, payload: unknown) => electron.pushed.push([channel, payload]) } }],
  },
  ipcMain: { handle: vi.fn() },
}))

const { CsocketApiService } = await import('../electron/main/cSocket/api')
const { CppSocketClient } = await import('../electron/main/cSocket/client')

type Reply = CsocketResult<CppAckResult>

/** C++ 的统一回复（和联调日志一致：message 在 result 上，data[0] 只有四个字段） */
const cppResult = (status: number, success: boolean, message = '', dates: Record<string, string> = {}): CppAckResult => ({
  success,
  code: 100,
  message,
  data: [{ activated_at: '', expire_at: '', grace_until: '', ...dates, status }],
})
const ack = (...args: Parameters<typeof cppResult>): Reply => ({ ok: true, data: cppResult(...args) })

const createApi = (reply: (optCmd: string) => Reply | Promise<Reply>, options: { connected?: boolean } = {}) => {
  const sent: { input: BuildEnvelopeInput; opts?: CsocketSendOpts2 }[] = []
  const listeners = new Set<(event: CppEnvelope) => void>()
  const client = {
    waitConnected: vi.fn(async () => options.connected ?? true),
    send: vi.fn(async (input: BuildEnvelopeInput, opts?: CsocketSendOpts2) => {
      sent.push({ input, opts })
      return reply(input.OptCmd)
    }),
    onMessage: (listener: (event: CppEnvelope) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onStatus: () => () => true,
    getStatus: () => ({ state: 'connected' as const }),
  }
  const api = new CsocketApiService(client as unknown as InstanceType<typeof CppSocketClient>)
  api.wireClientEvents()
  /** C++ 主动发来 / 超时后迟到的报文 */
  const receive = (envelope: Partial<CppEnvelope>) => {
    for (const l of listeners) l({ version: 1, timestamp: 0, messageId: 'late', addr: '', params: [], OptCmd: '', ...envelope })
  }
  return { api, sent, client, receive }
}

const stateOf = (result: LicenseAck) => licenseStateOf(result)!
const licensePushes = () => electron.pushed.filter(([channel]) => channel === CSOCKET_CHANNELS.licensePush)

afterEach(() => {
  electron.isPackaged = false
  electron.pushed.length = 0
  vi.useRealTimers()
})

describe('toLicenseInfo', () => {
  it('按约定映射 status：0 未激活 1 需校验 2 过期 3 正常，其余为 unknown', () => {
    const map = (status: number) => toLicenseInfo(cppResult(status, true))?.status
    expect([0, 1, 2, 3, 9].map(map)).toEqual(['inactive', 'needVerify', 'expired', 'valid', 'unknown'])
  })

  it('时间原样转述；data 里没有 message 时用 result.message', () => {
    const info = toLicenseInfo(cppResult(3, true, '授权正常', { activated_at: '2026-10-01', expire_at: '2027-10-01', grace_until: '2026-11-03' }))
    expect(info).toEqual({
      status: 'valid',
      statusCode: 3,
      activatedAt: '2026-10-01',
      expireAt: '2027-10-01',
      graceUntil: '2026-11-03',
      message: '授权正常',
    })
  })

  it('没有 data 或 status 时为 null', () => {
    expect(toLicenseInfo({ success: true, data: [] })).toBeNull()
    expect(toLicenseInfo({ success: true, data: [{ expire_at: '' }] })).toBeNull()
    expect(toLicenseInfo(undefined)).toBeNull()
  })
})

describe('LicenseStore', () => {
  it('只在变化时返回新快照；正常就放行，之后不再收回', () => {
    const store = new LicenseStore(false)
    expect(store.ingest(cppResult(0, false))?.passed).toBe(false)
    expect(store.ingest(cppResult(0, false))).toBeNull()
    expect(store.ingest(cppResult(3, true))?.passed).toBe(true)
    expect(store.ingest(cppResult(2, true))).toMatchObject({ passed: true, info: { status: 'expired' } })
  })

  it('跳过只在开发模式允许', () => {
    const prod = new LicenseStore(false)
    expect(prod.skip()).toBe(false)
    expect(prod.snapshot().passed).toBe(false)
    const dev = new LicenseStore(true)
    expect(dev.skip()).toBe(true)
    expect(dev.snapshot()).toMatchObject({ passed: true, skipped: true, devSkipAllowed: true })
  })
})

describe('CsocketApiService 授权指令', () => {
  it('查本地状态：发 Auth|localStatus，不带工程和用户；未激活不放行', async () => {
    const { api, sent } = createApi(() => ack(0, false, '未激活，请输入授权码激活。'))
    const result = await api.authLocalStatus()
    expect(sent[0].input).toEqual({ OptCmd: 'Auth|localStatus', addr: '0x0000', params: [] })
    expect(sent[0].opts).toEqual({ timeoutMs: 10_000 })
    expect(result).toMatchObject({ success: false, code: 100, message: '未激活，请输入授权码激活。' })
    expect(stateOf(result)).toMatchObject({ passed: false, info: { status: 'inactive' } })
  })

  it('正常就放行并推给界面，后台联网校验一次', async () => {
    const { api, sent } = createApi(() => ack(3, true))
    const result = await api.authLocalStatus()
    expect(stateOf(result).passed).toBe(true)
    expect(licensePushes()).toHaveLength(1)
    await vi.waitFor(() => expect(sent.map((s) => s.input.OptCmd)).toEqual(['Auth|localStatus', 'Auth|verify']))

    await api.authLocalStatus()
    expect(sent.filter((s) => s.input.OptCmd === 'Auth|verify')).toHaveLength(1)
  })

  it('同时多次查询只发一条', async () => {
    const { api, sent } = createApi(() => ack(0, false))
    await Promise.all([api.authLocalStatus(), api.authLocalStatus()])
    expect(sent).toHaveLength(1)
  })

  it('等不到连接返回 NOT_CONNECTED，不发', async () => {
    const { api, sent } = createApi(() => ack(0, false), { connected: false })
    const result = await api.authLocalStatus()
    expect(result).toMatchObject({ success: false, code: 'NOT_CONNECTED' })
    expect(sent).toHaveLength(0)
  })

  it('C++ 没回复返回 ACK_TIMEOUT 和中文原因，状态不变', async () => {
    const { api } = createApi(() => ({ ok: false, code: 'ACK_TIMEOUT', message: 'No ACK' }))
    const result = await api.authVerify()
    expect(result).toMatchObject({ success: false, code: 'ACK_TIMEOUT' })
    expect(result.message).toContain('联网校验超时')
    expect(stateOf(result)).toMatchObject({ passed: false, info: null })
  })

  it('激活：params [{ code }]，用联网的超时；失败带回 C++ 的原因', async () => {
    const { api, sent } = createApi(() => ack(0, false, '激活失败：授权码不存在'))
    const result = await api.authActivate([{ code: ' 1111-1111-1111-1111 ' }])
    expect(sent[0].input).toMatchObject({ OptCmd: 'Auth|activate', params: [{ code: '1111-1111-1111-1111' }] })
    expect(sent[0].opts?.timeoutMs).toBe(30_000)
    expect(result).toMatchObject({ success: false, message: '激活失败：授权码不存在' })
  })

  it('激活码为空不发', async () => {
    const { api, sent } = createApi(() => ack(3, true))
    await expect(api.authActivate([{ code: '  ' }])).resolves.toMatchObject({ success: false, code: 'INVALID_INPUT' })
    expect(sent).toHaveLength(0)
  })

  it('超时后迟到的 Auth 回复补进状态并推给界面', () => {
    const { api, receive } = createApi(() => ack(0, false))
    receive({ OptCmd: 'Auth|activate', result: cppResult(3, true, '激活成功') })
    expect(stateOf(api.getLicenseSnapshot()).passed).toBe(true)
    expect(licensePushes()).toHaveLength(1)
  })

  it('跳过：打包后不允许，未打包放行', async () => {
    electron.isPackaged = true
    const prod = createApi(() => ack(0, false))
    await expect(prod.api.authSkip()).resolves.toMatchObject({ success: false, code: 'NOT_ALLOWED' })

    electron.isPackaged = false
    const dev = createApi(() => ack(0, false))
    const result = await dev.api.authSkip()
    expect(stateOf(result)).toMatchObject({ passed: true, skipped: true })
  })
})

describe('CppSocketClient.waitConnected', () => {
  it('已连上立即返回；等不到超时返回 false', async () => {
    vi.useFakeTimers()
    const client = new CppSocketClient()
    const waiting = client.waitConnected(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBe(false)

    const later = client.waitConnected(1000)
    ;(client as unknown as { setStatus: (s: { state: string }) => void }).setStatus({ state: 'connected' })
    await expect(later).resolves.toBe(true)
    await expect(client.waitConnected(1000)).resolves.toBe(true)
  })
})
