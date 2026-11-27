import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
  save: vi.fn(),
  reveal: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showSaveDialog: ipc.save },
  shell: { showItemInFolder: ipc.reveal },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => Promise<unknown>) => ipc.handlers.set(key, fn) },
}))

import { registerRecordingHandlers } from '../electron/main/recording'
import { RECORDING_CHANNELS } from '../shared/recording'

const invoke = (channel: string, argument: unknown) => ipc.handlers.get(channel)!({ sender: {} }, argument)
const video = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]).buffer
let folder: string

beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'stage-recording-'))
  ipc.save.mockReset()
  ipc.reveal.mockReset()
  registerRecordingHandlers()
})
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })

it('saves the supplied bytes and reveals only successfully exported files', async () => {
  const file = path.join(folder, '排练.webm')
  ipc.save.mockResolvedValue({ filePath: path.join(folder, '排练'), canceled: false })
  await expect(invoke(RECORDING_CHANNELS.revealVideo, file)).rejects.toThrow()
  await expect(invoke(RECORDING_CHANNELS.saveVideo, video)).resolves.toBe(file)
  expect(await readFile(file)).toEqual(Buffer.from(video))
  await invoke(RECORDING_CHANNELS.revealVideo, file)
  expect(ipc.reveal).toHaveBeenCalledWith(file)
})

it('replaces the exact filename confirmed in the save dialog, including uppercase extensions', async () => {
  const file = path.join(folder, '排练.WEBM')
  await writeFile(file, 'old')
  ipc.save.mockResolvedValue({ filePath: file, canceled: false })
  await expect(invoke(RECORDING_CHANNELS.saveVideo, video)).resolves.toBe(file)
  expect(await readFile(file)).toEqual(Buffer.from(video))
})

it('retains the prior file when suffix completion leads to an existing recording and the user cancels', async () => {
  const file = path.join(folder, '排练.webm')
  await writeFile(file, 'prior recording')
  ipc.save.mockResolvedValueOnce({ filePath: path.join(folder, '排练'), canceled: false })
          .mockResolvedValueOnce({ canceled: true })
  await expect(invoke(RECORDING_CHANNELS.saveVideo, video)).resolves.toBe(null)
  expect(await readFile(file, 'utf8')).toBe('prior recording')
  expect(ipc.reveal).not.toHaveBeenCalled()
})
