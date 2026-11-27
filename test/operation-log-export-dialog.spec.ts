import path from 'node:path'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { CsocketApiService } from '../electron/main/cSocket/api'
import { registerCppSocketIpc } from '../electron/main/cSocket/ipc'
import { createCsocketApi } from '../electron/preload/csocket-api'

const state = vi.hoisted(() => ({
  current: vi.fn<() => string | null>(),
  dialog: vi.fn(),
  exportLog: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  window: {},
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => state.window },
  dialog: { showSaveDialog: state.dialog },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler) },
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({ sender: {} }, ...args) },
}))
vi.mock('../electron/main/project/service', () => ({ getCurrentProjectName: state.current }))
vi.mock('../electron/main/project/paths', () => ({ getProjectDir: (name: string) => path.join('Project', name) }))
vi.mock('../electron/main/cSocket/operation-log-export', () => ({ exportProjectLog: state.exportLog }))

const api = createCsocketApi()
beforeAll(() => registerCppSocketIpc({ wireClientEvents: vi.fn() } as unknown as CsocketApiService))
beforeEach(() => {
  vi.resetAllMocks()
  state.current.mockReturnValue('工程甲')
})

it('按打开保存框时的工程导出，允许给所选文件名补 .log', async () => {
  state.dialog.mockImplementation(async () => {
    state.current.mockReturnValue('工程乙')
    return { canceled: false, filePath: '演出记录' }
  })
  await expect(api.logExport()).resolves.toEqual({ canceled: false })
  expect(state.dialog).toHaveBeenCalledWith(state.window, expect.objectContaining({ defaultPath: '工程甲.log' }))
  expect(state.exportLog).toHaveBeenCalledWith(path.join('Project', '工程甲'), '演出记录.log', false)
})

it('补后缀遇到同名文件时，仅覆盖用户在保存框中确认的路径', async () => {
  state.dialog.mockResolvedValueOnce({ canceled: false, filePath: '演出' })
    .mockResolvedValueOnce({ canceled: false, filePath: '演出.LOG' })
  state.exportLog.mockRejectedValueOnce(Object.assign(new Error(), { code: 'EEXIST' }))
  await expect(api.logExport()).resolves.toEqual({ canceled: false })
  expect(state.dialog).toHaveBeenLastCalledWith(state.window, expect.objectContaining({ defaultPath: '演出.log' }))
  expect(state.exportLog).toHaveBeenLastCalledWith(path.join('Project', '工程甲'), '演出.LOG', true)
})

it('取消保存时不创建文件', async () => {
  state.dialog.mockResolvedValue({ canceled: true })
  await expect(api.logExport()).resolves.toEqual({ canceled: true })
  expect(state.exportLog).not.toHaveBeenCalled()
})

it('没有打开工程时不弹出保存框', async () => {
  state.current.mockReturnValue(null)
  await expect(api.logExport()).rejects.toThrow('没有打开工程')
  expect(state.dialog).not.toHaveBeenCalled()
})
