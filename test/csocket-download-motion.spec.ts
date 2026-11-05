import { describe, expect, it, vi } from 'vitest'
import type { BuildEnvelopeInput, CppAckResult, CppEnvelope, CsocketResult } from '../shared/csocket/types'
import { axisMotionDownloadBlock, movingAxisIds } from '../shared/csocket/axis-info'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}))

const { CsocketApiService } = await import('../electron/main/cSocket/api')
const { CppSocketClient } = await import('../electron/main/cSocket/client')

const createApi = () => {
  const sent: string[] = []
  const listeners = new Set<(event: CppEnvelope) => void>()
  const client = {
    waitConnected: vi.fn(async () => true),
    send: vi.fn(async (input: BuildEnvelopeInput): Promise<CsocketResult<CppAckResult>> => {
      sent.push(input.OptCmd)
      return { ok: true, data: { success: true } }
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
  const axisFrame = (data: Record<string, number>[]) => {
    for (const listener of listeners) {
      listener({
        version: 1,
        timestamp: 0,
        messageId: 'push',
        addr: '',
        params: [],
        OptCmd: 'Info|axis',
        result: { success: true, data },
      } as CppEnvelope)
    }
  }
  return { api, sent, axisFrame }
}

describe('moving axes', () => {
  it('lists axes whose axisStatus is 3, sorted', () => {
    expect(
      movingAxisIds([
        { deviceId: 9, axisStatus: 3 },
        { deviceId: 2, axisStatus: 2 },
        { deviceId: 4, axisStatus: 3 },
        { deviceId: 5 },
      ]),
    ).toEqual([4, 9])
  })

  it('blocks a download only while some axis moves', () => {
    expect(axisMotionDownloadBlock([{ deviceId: 1, axisStatus: 3 }, { deviceId: 2, axisStatus: 3 }])).toBe(
      '2 个轴运动中，全部停止后再下载',
    )
    expect(axisMotionDownloadBlock([{ deviceId: 1, axisStatus: 2 }])).toBeNull()
    expect(axisMotionDownloadBlock([])).toBeNull()
  })
})

describe('CsocketApiService.downloadPlcProject', () => {
  it('does not send the download while the master reports a moving axis', async () => {
    const { api, sent, axisFrame } = createApi()
    axisFrame([
      { deviceId: 1, axisStatus: 2, actualPosition: 0 },
      { deviceId: 2, axisStatus: 3, actualPosition: 10 },
    ])

    const result = await api.downloadPlcProject([{ deviceId: 1 }])

    expect(result).toMatchObject({ success: false, code: 'AXIS_MOVING', message: '1 个轴运动中，全部停止后再下载' })
    expect(sent).not.toContain('CONFIG|Pro|download')
  })

  it('sends it once every axis has stopped', async () => {
    const { api, sent, axisFrame } = createApi()
    axisFrame([{ deviceId: 2, axisStatus: 3 }])
    axisFrame([{ deviceId: 2, axisStatus: 2 }])

    const result = await api.downloadPlcProject([{ deviceId: 1 }])

    expect(result.success).toBe(true)
    expect(sent).toContain('CONFIG|Pro|download')
  })

  it('allows the download when no axis state has arrived', async () => {
    const { api, sent } = createApi()
    await api.downloadPlcProject([{ deviceId: 1 }])
    expect(sent).toContain('CONFIG|Pro|download')
  })
})
