import { BrowserWindow, dialog, ipcMain } from 'electron'

export type ConfirmToolParams = {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作：使用 warning 图标，其余用 question */
  danger?: boolean
}

let registered = false

/**
 * 确认对话框统一走主进程原生 dialog，避免无边框窗口下
 * window.confirm 关闭后渲染进程键盘焦点丢失。
 */
export const registerToolHandlers = (): void => {
  if (registered) return
  registered = true

  ipcMain.handle(
    'tool:confirm',
    async (event, params: ConfirmToolParams): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: (params.danger ? 'warning' : 'question') as 'warning' | 'question',
        title: params.title ?? '确认',
        message: params.message,
        detail: params.detail,
        buttons: [params.confirmLabel ?? '确定', params.cancelLabel ?? '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }

      const result = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      return result.response === 0
    },
  )
}
