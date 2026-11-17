import { describe, expect, it, vi } from 'vitest'
import type { BuildEnvelopeInput, CppAckResult, CppEnvelope, CsocketResult, CsocketSendOpts2 } from '../shared/csocket/types'
import { buildEnvelope } from '../shared/csocket/codec'
import type { HaForwardEnvelope } from '../shared/ha/protocol'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}))

const { CsocketApiService } = await import('../electron/main/cSocket/api')
const { CppSocketClient } = await import('../electron/main/cSocket/client')

const createApi = (ack: CppAckResult = { success: true }) => {
  const sent: { input: BuildEnvelopeInput; opts?: CsocketSendOpts2 }[] = []
  const listeners = new Set<(event: CppEnvelope) => void>()
  const statusListeners = new Set<(status: { state: string }) => void>()
  const client = {
    waitConnected: vi.fn(async () => true),
    send: vi.fn(async (input: BuildEnvelopeInput, opts?: CsocketSendOpts2): Promise<CsocketResult<CppAckResult>> => {
      sent.push({ input, opts })
      return { ok: true, data: ack }
    }),
    onMessage: (listener: (event: CppEnvelope) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onStatus: (listener: (status: { state: string }) => void) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    getStatus: () => ({ state: 'connected' as const }),
  }
  const api = new CsocketApiService(client as unknown as InstanceType<typeof CppSocketClient>)
  api.wireClientEvents()
  api.configure({ userName: 'operator' })
  const push = (OptCmd: string, data: unknown[]) => {
    for (const listener of listeners) {
      listener({ version: 1, timestamp: 0, messageId: 'push', addr: '', params: [], OptCmd, result: { success: true, data } })
    }
  }
  const setStatus = (state: string) => {
    for (const listener of statusListeners) listener({ state })
  }
  return { api, sent, push, setStatus }
}

const hooks = (
  gate: (optCmd: string, params: unknown[]) => { block: string } | { noPlc: boolean } = () => ({ noPlc: false }),
) => {
  const calls: { envelope: HaForwardEnvelope; stage: 'sent' | 'acked' }[] = []
  const pushes: { optCmd: string; result: CppAckResult | undefined }[] = []
  const states: string[] = []
  return {
    calls,
    pushes,
    states,
    value: {
      gate,
      sent: (envelope: HaForwardEnvelope, stage: 'sent' | 'acked') => calls.push({ envelope, stage }),
      push: (optCmd: string, result: CppAckResult | undefined) => pushes.push({ optCmd, result }),
      connection: (state: string) => states.push(state),
    },
  }
}

describe('noPlc envelope flag', () => {
  it('is only written when set', () => {
    expect(buildEnvelope({ OptCmd: 'Opera|jog', addr: '', params: [] })).not.toHaveProperty('noPlc')
    expect(buildEnvelope({ OptCmd: 'Opera|jog', addr: '', params: [], noPlc: true })).toMatchObject({ noPlc: true })
  })
})

describe('CsocketApiService with hot standby hooks', () => {
  it('sends unchanged and reports sent + acked without hooks side effects on the envelope', async () => {
    const { api, sent } = createApi()
    const h = hooks()
    api.setHaHooks(h.value)
    await api.jogModel([{ deviceId: 6, virtualAxisId: 1, direction: 1 } as never])
    expect(sent).toHaveLength(1)
    expect(sent[0].input).not.toHaveProperty('noPlc')
    expect(h.calls.map((call) => [call.envelope.OptCmd, call.stage])).toEqual([
      ['Opera|jog', 'sent'],
      ['Opera|jog', 'acked'],
    ])
    expect(h.calls[0].envelope).toMatchObject({ addr: '0x0104', userName: 'operator' })
  })

  it('does not report acked when C++ answers failure', async () => {
    const { api } = createApi({ success: false, code: 1 })
    const h = hooks()
    api.setHaHooks(h.value)
    await api.jogModel([{ deviceId: 6, virtualAxisId: 1, direction: 1 } as never])
    expect(h.calls.map((call) => call.stage)).toEqual(['sent'])
  })

  it('adds the flag the gate asks for and keeps flagged commands out of command sync', async () => {
    const { api, sent } = createApi()
    const h = hooks((optCmd) => (optCmd.startsWith('Config|') ? { noPlc: true } : { noPlc: false }))
    api.setHaHooks(h.value)
    await api.configureModelParamModel([{ deviceId: 6, paramCount: { modelType: 1 } } as never])
    expect(sent[0].input).toMatchObject({ OptCmd: 'Config|modelParam', noPlc: true })
    expect(h.calls).toEqual([])
  })

  it('does not send a command the gate blocks', async () => {
    const { api, sent } = createApi()
    api.setHaHooks(hooks(() => ({ block: '备机上不能做整台 PLC 的操作' })).value)
    const result = await api.resetPlc([{ deviceId: 1 }])
    expect(result).toEqual({ success: false, code: 'HA_BLOCKED', message: '备机上不能做整台 PLC 的操作' })
    expect(sent).toEqual([])
  })

  it('keeps sending when a hook throws', async () => {
    const { api, sent } = createApi()
    api.setHaHooks({
      gate: () => {
        throw new Error('boom')
      },
      sent: () => {
        throw new Error('boom')
      },
      push: () => undefined,
      connection: () => undefined,
    })
    const result = await api.stopModel([{ deviceId: 6 }])
    expect(sent).toHaveLength(1)
    expect(result).toMatchObject({ success: true })
  })

  it('sends HA|send without waiting for an answer and forwards with the flag', async () => {
    const { api, sent } = createApi()
    expect(await api.haSend(['192.168.0.101'], { type: 'hello' })).toBe(true)
    expect(sent[0]).toEqual({
      input: { OptCmd: 'HA|send', addr: '', params: [{ to: ['192.168.0.101'], payload: { type: 'hello' } }] },
      opts: { waitAck: false },
    })
    await api.sendForwarded({ OptCmd: 'Opera|jog', addr: '0x0104', params: [{ deviceId: 6 }], userName: 'b-operator' })
    expect(sent[1].input).toMatchObject({ OptCmd: 'Opera|jog', noPlc: true, userName: 'b-operator' })
  })

  it('starts and stops through HA|start / HA|stop', async () => {
    const { api, sent } = createApi()
    await api.haStart({ role: 'standby', ip: '192.168.0.101', primaryIp: '192.168.0.100' })
    await api.haStop()
    expect(sent.map((item) => item.input)).toEqual([
      expect.objectContaining({
        OptCmd: 'HA|start',
        params: [{ role: 'standby', ip: '192.168.0.101', primaryIp: '192.168.0.100' }],
        userName: undefined,
      }),
      expect.objectContaining({ OptCmd: 'HA|stop', params: [] }),
    ])
  })

  it('routes Info|ha, Info|haRecv and the connection state to the hooks', () => {
    const { api, push, setStatus } = createApi()
    const h = hooks()
    api.setHaHooks(h.value)
    push('Info|ha', [{ role: 'primary', peers: [] }])
    push('Info|haRecv', [{ from: '192.168.0.101', payload: { type: 'hello' } }])
    push('Info|plc', [])
    setStatus('reconnecting')
    expect(h.pushes.map((item) => item.optCmd)).toEqual(['Info|ha', 'Info|haRecv'])
    expect(h.pushes[1].result?.data).toEqual([{ from: '192.168.0.101', payload: { type: 'hello' } }])
    expect(h.states).toEqual(['reconnecting'])
  })
})
