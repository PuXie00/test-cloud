import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  takeInstallOutcome,
  UNKNOWN_INSTALL_FAILURE,
  writePendingInstall,
} from '../electron/main/update/install-record'
import { describeLinuxInstallExit } from '../electron/main/update/installers'

describe('上次在软件里安装的结果', () => {
  let tmp: string
  let pendingFile: string
  let resultFile: string

  const pending = { fromVersion: '1.1.0', toVersion: '1.2.0', startedAt: '2026-11-17T08:00:00.000Z' }
  const take = (currentVersion: string, withResult = true) =>
    takeInstallOutcome({
      pendingFile,
      currentVersion,
      resultFile: withResult ? resultFile : undefined,
      describeExit: describeLinuxInstallExit,
    })
  const exists = (file: string) =>
    fs.access(file).then(
      () => true,
      () => false,
    )

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-install-record-'))
    pendingFile = path.join(tmp, 'Updates', 'pending-install.json')
    resultFile = path.join(tmp, 'Updates', 'install-result.txt')
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('没有记录就不报', async () => {
    expect(await take('1.1.0')).toBeNull()
  })

  it('已经是目标版本：装好了，记录只报一次', async () => {
    await writePendingInstall(pendingFile, pending)
    await fs.writeFile(resultFile, '0\n')
    expect(await take('1.2.0')).toEqual({ ok: true, pending })
    expect(await exists(pendingFile)).toBe(false)
    expect(await exists(resultFile)).toBe(false)
    expect(await take('1.2.0')).toBeNull()
  })

  it('还是原来的版本：按退出码说明原因', async () => {
    await writePendingInstall(pendingFile, pending)
    await fs.writeFile(resultFile, '126\n')
    expect(await take('1.1.0')).toEqual({ ok: false, pending, reason: describeLinuxInstallExit(126) })
    expect(describeLinuxInstallExit(126)).toContain('授权窗口被关掉')
  })

  it('没有退出码（Windows，或脚本没跑完）：说不清具体原因', async () => {
    await writePendingInstall(pendingFile, pending)
    expect(await take('1.1.0', false)).toEqual({ ok: false, pending, reason: UNKNOWN_INSTALL_FAILURE })
    await writePendingInstall(pendingFile, pending)
    expect(await take('1.1.0')).toEqual({ ok: false, pending, reason: UNKNOWN_INSTALL_FAILURE })
  })

  it('之后又换过别的版本、记录坏了：不报，也删掉', async () => {
    await writePendingInstall(pendingFile, pending)
    expect(await take('1.3.0')).toBeNull()
    expect(await exists(pendingFile)).toBe(false)
    await fs.writeFile(pendingFile, '{')
    expect(await take('1.1.0')).toBeNull()
    expect(await exists(pendingFile)).toBe(false)
  })
})
