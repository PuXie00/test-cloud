import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 在软件里启动安装前记一笔，下次启动按当时的版本判断装没装成。
 * 安装程序是分离进程，软件退出后才装：Windows 静默安装出错不会有任何提示，
 * Linux 授权窗口被关掉、apt-get 失败后会重新打开旧版本，都得告诉人「没升级成」。
 */
export type PendingInstall = {
  fromVersion: string
  toVersion: string
  /** ISO 时间 */
  startedAt: string
}

export type InstallOutcome =
  | { ok: true; pending: PendingInstall }
  | { ok: false; pending: PendingInstall; reason: string }

export const writePendingInstall = async (file: string, pending: PendingInstall): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(pending)}\n`, 'utf8')
}

export const clearPendingInstall = (file: string): Promise<void> => fs.rm(file, { force: true })

const parsePending = (text: string): PendingInstall | null => {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const { fromVersion, toVersion, startedAt } = value
    if (typeof fromVersion !== 'string' || typeof toVersion !== 'string' || typeof startedAt !== 'string') return null
    return { fromVersion, toVersion, startedAt }
  } catch {
    return null
  }
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** 没有安装步骤留下的结果时（Windows，或 Linux 的脚本没跑完）的说法 */
export const UNKNOWN_INSTALL_FAILURE = '安装程序没有装完：可能被取消、出错，或者中途断电'

/**
 * 读上次在软件里安装的结果，读完删掉记录（只报一次）。
 * 现在是目标版本 → 装好了；还是原来的版本 → 没装成；都不是（之后又手动装过别的版本）→ 不报。
 * resultFile 是平台安装步骤留下的退出码（Linux），describeExit 把它说成人话。
 */
export const takeInstallOutcome = async (input: {
  pendingFile: string
  currentVersion: string
  resultFile?: string
  describeExit?: (code: number) => string
}): Promise<InstallOutcome | null> => {
  const text = await readText(input.pendingFile)
  if (text === null) return null
  const resultText = input.resultFile ? await readText(input.resultFile) : null
  await clearPendingInstall(input.pendingFile)
  if (input.resultFile) await fs.rm(input.resultFile, { force: true })

  const pending = parsePending(text)
  if (!pending) return null
  if (input.currentVersion === pending.toVersion) return { ok: true, pending }
  if (input.currentVersion !== pending.fromVersion) return null

  const code = resultText === null ? Number.NaN : Number.parseInt(resultText.trim(), 10)
  const reason =
    Number.isInteger(code) && input.describeExit ? input.describeExit(code) : UNKNOWN_INSTALL_FAILURE
  return { ok: false, pending, reason }
}
