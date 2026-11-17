import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APT_GET_PATH,
  describeLinuxInstallExit,
  launchLinuxInstall,
  LINUX_INSTALL_EXIT,
  linuxInstallUnsupportedReason,
  linuxRunnerArgs,
  PKEXEC_PATH,
  type LinuxInstallRequest,
} from '../electron/main/update/installers'

describe('Linux 能不能在软件里装', () => {
  const everything = new Set([PKEXEC_PATH, APT_GET_PATH, '/opt/yzapp/resources/linux/yz-install-update'])
  const reason = (patch: { execPath?: string; missing?: string } = {}) =>
    linuxInstallUnsupportedReason({
      execPath: patch.execPath ?? '/opt/yzapp/yzapp',
      resourcesPath: '/opt/yzapp/resources',
      exists: (file) => everything.has(file) && file !== patch.missing,
    })

  it('deb 装在 /opt 下、系统有 pkexec 和 apt-get 才能装', () => {
    expect(reason()).toBeNull()
    expect(reason({ execPath: '/home/op/yzapp/linux-unpacked/yzapp' })).toContain('不是用 deb 安装包装的')
    expect(reason({ missing: '/opt/yzapp/resources/linux/yz-install-update' })).toContain('缺少升级辅助程序')
    expect(reason({ missing: PKEXEC_PATH })).toContain('pkexec')
    expect(reason({ missing: APT_GET_PATH })).toContain('apt-get')
  })

  it('退出码说成人话', () => {
    expect(describeLinuxInstallExit(LINUX_INSTALL_EXIT.dismissed)).toContain('没有输入管理员密码')
    expect(describeLinuxInstallExit(LINUX_INSTALL_EXIT.notAuthorized)).toContain('没有通过管理员授权')
    expect(describeLinuxInstallExit(LINUX_INSTALL_EXIT.verify)).toContain('校验没通过')
    expect(describeLinuxInstallExit(LINUX_INSTALL_EXIT.aptFailed)).toContain('apt-get')
    expect(describeLinuxInstallExit(LINUX_INSTALL_EXIT.appStillRunning)).toContain('没有按时退出')
    expect(describeLinuxInstallExit(99)).toContain('退出码 99')
  })
})

describe.skipIf(process.platform === 'win32')('Linux 安装脚本（软件退出后跑）', () => {
  let tmp: string
  let request: LinuxInstallRequest
  let marker: string

  /** 假 pkexec：把参数记进输出，按给定退出码退出 */
  const fakePkexec = async (code: number) => {
    const file = path.join(tmp, `pkexec-${code}`)
    await fs.writeFile(file, `#!/bin/sh\necho "pkexec-args: $*"\nexit ${code}\n`, { mode: 0o755 })
    return file
  }

  /** 已经退出的进程号 */
  const deadPid = () => spawnSync('/bin/true').pid

  const run = (patch: Partial<LinuxInstallRequest>) =>
    spawnSync('/bin/sh', linuxRunnerArgs({ ...request, ...patch }), { encoding: 'utf8', timeout: 20_000 })

  const read = (file: string) => fs.readFile(file, 'utf8').catch(() => null)

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-linux-install-'))
    marker = path.join(tmp, 'relaunched')
    request = {
      appPid: deadPid(),
      pkexec: await fakePkexec(0),
      helper: '/opt/yzapp/resources/linux/yz-install-update',
      packageDir: path.join(tmp, 'Updates', 'packages', '1.2.0'),
      resultFile: path.join(tmp, 'Updates', 'install-result.txt'),
      logFile: path.join(tmp, 'Updates', 'install.log'),
      // 「重新打开软件」：把收到的参数写进 marker
      relaunch: ['/bin/sh', '-c', 'echo "$@" > "$0"', marker, '--some-flag', 'x y'],
    }
    await fs.mkdir(path.dirname(request.resultFile), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('装好了：pkexec 跑辅助程序，写退出码，带原参数重新打开软件', async () => {
    expect(run({}).status).toBe(0)
    expect(await read(request.resultFile)).toBe('0\n')
    const log = await read(request.logFile)
    expect(log).toContain(`pkexec-args: ${request.helper} ${request.packageDir}`)
    expect(log).toContain('== 退出码 0')
    expect(await read(marker)).toBe('--some-flag x y\n')
  })

  it('授权窗口被关掉：记下 126，照样打开（还是旧版本）', async () => {
    run({ pkexec: await fakePkexec(LINUX_INSTALL_EXIT.dismissed) })
    expect(await read(request.resultFile)).toBe('126\n')
    expect(await read(marker)).toBe('--some-flag x y\n')
  })

  it('软件一直不退出：不装，也不再打开第二个', async () => {
    run({ appPid: process.pid, waitTicks: 1 })
    expect(await read(request.resultFile)).toBe(`${LINUX_INSTALL_EXIT.appStillRunning}\n`)
    const log = await read(request.logFile)
    expect(log).toContain('没有退出')
    expect(log).not.toContain('pkexec-args')
    expect(await read(marker)).toBeNull()
  })

  it('分离进程启动，先删掉上次留下的退出码', async () => {
    await fs.writeFile(request.resultFile, '999\n')
    await launchLinuxInstall(request)
    const deadline = Date.now() + 10_000
    while ((await read(marker)) === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(await read(marker)).toBe('--some-flag x y\n')
    expect(await read(request.resultFile)).toBe('0\n')
  })
})
