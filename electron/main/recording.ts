import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { RECORDING_CHANNELS } from '../../shared/recording'

export function registerRecordingHandlers(): void {
  const exportedPaths = new Set<string>()
  ipcMain.handle(RECORDING_CHANNELS.saveVideo, async (event, bytes: ArrayBuffer) => {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      throw new Error('没有可导出的视频数据')
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('找不到导出窗口')

    const time = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-')
    let defaultPath = `舞台录制-${time}.webm`
    while (true) {
      const selected = await dialog.showSaveDialog(win, {
        title: '导出 3D 录制视频',
        defaultPath,
        filters: [{ name: 'WebM 视频', extensions: ['webm'] }],
        properties: ['showOverwriteConfirmation'],
      })
      if (selected.canceled || !selected.filePath) return null

      const exactName = path.extname(selected.filePath).toLowerCase() === '.webm'
      const filePath = exactName ? selected.filePath : `${selected.filePath}.webm`
      // 只有对话框内选中的完整路径已确认覆盖；补后缀时必须独占创建。
      if (!exactName) {
        let file
        try {
          file = await fs.open(filePath, 'wx')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          defaultPath = filePath
          continue
        }
        try {
          try {
            await file.writeFile(new Uint8Array(bytes))
          } finally {
            await file.close()
          }
        } catch (err) {
          await fs.rm(filePath, { force: true })
          throw err
        }
      } else {
        // 写满后再覆盖，磁盘满或写入失败时旧视频仍可播放。
        const tmp = path.join(path.dirname(filePath), `.recording-${randomUUID()}.part`)
        try {
          await fs.writeFile(tmp, new Uint8Array(bytes), { flag: 'wx' })
          await fs.rename(tmp, filePath)
        } finally {
          await fs.rm(tmp, { force: true })
        }
      }
      exportedPaths.add(filePath)
      return filePath
    }
  })

  ipcMain.handle(RECORDING_CHANNELS.revealVideo, async (_event, filePath: string) => {
    if (!exportedPaths.has(filePath)) throw new Error('请选择此会话中导出的视频')
    if (!(await fs.stat(filePath)).isFile()) throw new Error('导出的视频文件不存在')
    shell.showItemInFolder(filePath)
  })
}
