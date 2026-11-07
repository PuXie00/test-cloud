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

/** 点 ✕ 后渲染进程多久没接住（卡死、白屏）就直接关，别把人关在里面 */
const CLOSE_ACK_TIMEOUT_MS = 3000

type CloseGuardState = {
  /** 渲染进程报的：有没保存的修改 */
  guarded: boolean
  /** 渲染进程确认过可以关了 */
  confirmed: boolean
  ackTimer: ReturnType<typeof setTimeout> | null
}

const closeGuards = new Map<number, CloseGuardState>()

const clearAckTimer = (state: CloseGuardState): void => {
  if (!state.ackTimer) return
  clearTimeout(state.ackTimer)
  state.ackTimer = null
}

/**
 * 点窗口 ✕：渲染进程报了有没保存的修改时先不关，交给它弹「保存 / 不保存 / 取消」，
 * 它确认后再真正关闭。刷新、崩溃后标记清掉，没有修改时照常直接关。
 */
export const attachCloseGuard = (win: BrowserWindow): void => {
  const id = win.webContents.id
  const state: CloseGuardState = { guarded: false, confirmed: false, ackTimer: null }
  closeGuards.set(id, state)
  const reset = () => {
    state.guarded = false
  }
  win.webContents.on('did-start-loading', reset)
  win.webContents.on('render-process-gone', reset)
  win.on('close', (event) => {
    if (!state.guarded || state.confirmed) return
    event.preventDefault()
    win.webContents.send('tool:close-request')
    clearAckTimer(state)
    state.ackTimer = setTimeout(() => {
      state.ackTimer = null
      state.confirmed = true
      win.close()
    }, CLOSE_ACK_TIMEOUT_MS)
  })
  win.on('closed', () => {
    clearAckTimer(state)
    closeGuards.delete(id)
  })
}

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

  ipcMain.on('tool:close-guard', (event, guarded: unknown) => {
    const state = closeGuards.get(event.sender.id)
    if (state) state.guarded = guarded === true
  })
  // 渲染进程收到关闭请求了（在弹窗），不用超时强关
  ipcMain.on('tool:close-ack', (event) => {
    const state = closeGuards.get(event.sender.id)
    if (state) clearAckTimer(state)
  })
  ipcMain.on('tool:close-confirm', (event) => {
    const state = closeGuards.get(event.sender.id)
    if (!state) return
    clearAckTimer(state)
    state.confirmed = true
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
