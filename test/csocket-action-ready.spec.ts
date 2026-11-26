import { describe, expect, it, vi } from 'vitest'
import type { ActionDataSaveItem } from '../shared/csocket/action-data-save'
import type { BuildEnvelopeInput, CppAckResult, CsocketResult } from '../shared/csocket/types'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}))

const { CsocketApiService } = await import('../electron/main/cSocket/api')
const { CppSocketClient } = await import('../electron/main/cSocket/client')

type Sent = { OptCmd: string; params: unknown[]; paramHeard?: unknown[] }

/** 假的 C++：记下发了什么；acks 按指令名给应答，缺省成功 */
const createApi = (acks: Record<string, CppAckResult> = {}) => {
  const sent: Sent[] = []
  const client = {
    waitConnected: vi.fn(async () => true),
    send: vi.fn(async (input: BuildEnvelopeInput): Promise<CsocketResult<CppAckResult>> => {
      sent.push({
        OptCmd: input.OptCmd,
        params: input.params as unknown[],
        ...(input.paramHeard ? { paramHeard: input.paramHeard as unknown[] } : {}),
      })
      return { ok: true, data: acks[input.OptCmd] ?? { success: true } }
    }),
    onMessage: () => () => true,
    onStatus: () => () => true,
    getStatus: () => ({ state: 'connected' as const }),
  }
  const api = new CsocketApiService(client as unknown as InstanceType<typeof CppSocketClient>)
  return { api, sent }
}

const forcedItem: ActionDataSaveItem = {
  actionId: 5,
  totalDuration: 3000,
  trajectoryMode: true,
  timelineCount: 1,
  timelineList: [{ modelId: 1, virtualAxisNo: 1, segmentCount: 0, segmentList: [] }],
  modelList: [{ deviceId: 1, timeBlockList: [] }],
  IOBlockList: [],
  runDirection: true,
  safeGroup: 1,
  deviceId: [1, 2],
  loopCount: 1,
  speedScale: 0.8,
}

describe('CsocketApiService.actionReady (forced trajectory)', () => {
  it('saves the action data, then sends actionSyncPrepare with the ready-time speed', async () => {
    const { api, sent } = createApi()
    const acks = await api.actionReady([forcedItem])

    expect(sent.map((item) => item.OptCmd)).toEqual(['Config2|actionDataSave', 'Opera|actionSyncPrepare'])
    expect(sent[1]?.paramHeard).toEqual([
      {
        actionId: 5,
        runDirection: 1,
        speedScale: 80,
        loopCount: 1,
        selectedCurveTimeMs: 0,
        deviceCount: 2,
        prepareTimeMs: 0,
      },
    ])
    expect(sent[1]?.params).toHaveLength(2)
    expect(acks).toHaveLength(2)
    expect(acks.every((ack) => ack.success)).toBe(true)
  })

  it('does not send actionSyncPrepare when the save fails or the PLC reports errors', async () => {
    const failed = createApi({ 'Config2|actionDataSave': { success: false, message: 'busy' } })
    const failedAcks = await failed.api.actionReady([forcedItem])
    expect(failed.sent.map((item) => item.OptCmd)).toEqual(['Config2|actionDataSave'])
    expect(failedAcks).toEqual([expect.objectContaining({ success: false })])

    const withErrors = createApi({
      'Config2|actionDataSave': { success: true, data: [{ errorCount: 2, errorCode: [1, 2] }] },
    })
    await withErrors.api.actionReady([forcedItem])
    expect(withErrors.sent.map((item) => item.OptCmd)).toEqual(['Config2|actionDataSave'])
  })

  it('reports a rejected actionSyncPrepare as a failed ack', async () => {
    const { api } = createApi({ 'Opera|actionSyncPrepare': { success: false, code: 7, message: '准备失败' } })
    const acks = await api.actionReady([forcedItem])
    expect(acks[1]).toMatchObject({ success: false, code: '7', message: '准备失败' })
  })
})

describe('CsocketApiService.actionGo (forced trajectory)', () => {
  it('only releases with actionSyncRelease; actionSyncPrepare already went out at Ready', async () => {
    const { api, sent } = createApi()
    await api.actionGo([
      {
        actionId: 5,
        runDirection: 1,
        speedScale: 1.5,
        loopCount: 1,
        trajectoryMode: true,
        deviceId: [1, 2],
        selectedCurveTimeMs: 400,
        prepareTimeMs: 1000,
      },
    ])
    expect(sent.map((item) => item.OptCmd)).toEqual(['Opera|actionSyncRelease'])
    expect(sent[0]?.paramHeard).toEqual([
      expect.objectContaining({ actionId: 5, startFlag: 2, deviceCount: 2 }),
    ])
  })
})
