import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 各平台怎么在软件里启动安装。都是分离进程：先拉起来，软件再退出，装完重新打开软件。
 * - Windows：NSIS 安装程序静默装（--updated 让它先跑旧版本的卸载程序，Project 由 build/installer.nsh 保住）
 * - Linux（deb，Ubuntu）：普通用户身份的脚本等软件退出，用 pkexec 以 root 跑 build/linux/yz-install-update
 *   （弹系统授权窗口），它重新验签名后 apt-get 装；工程在 /opt/yzapp/Project，不归 dpkg 管，升级、回退、卸载都不动
 */

/** NSIS 静默安装，装完自动打开（参数同 electron-updater 的 NsisUpdater） */
export const NSIS_SILENT_ARGS = ['--updated', '/S', '--force-run'] as const

export const spawnDetached = (file: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

// ---------------------------------------------------------------- Linux

/** deb 装在 /opt/<productName>（electron-builder 固定的位置） */
export const LINUX_INSTALL_PREFIX = '/opt'
/** root 辅助程序，相对 resources 目录（electron-builder linux.extraResources 从 build/linux/ 拷过去） */
export const LINUX_INSTALL_HELPER = 'linux/yz-install-update'
export const PKEXEC_PATH = '/usr/bin/pkexec'
export const APT_GET_PATH = '/usr/bin/apt-get'

/** 等软件退出最多多少个 0.2 秒 */
export const LINUX_WAIT_EXIT_TICKS = 300

/** 退出码：10–20 见 yz-install-update；30 是下面的脚本；126、127 是 pkexec 的 */
export const LINUX_INSTALL_EXIT = {
  ok: 0,
  usage: 10,
  prepare: 11,
  verify: 12,
  aptFailed: 20,
  appStillRunning: 30,
  dismissed: 126,
  notAuthorized: 127,
} as const

export const describeLinuxInstallExit = (code: number): string => {
  switch (code) {
    case LINUX_INSTALL_EXIT.ok:
      return '安装程序报告装好了，但软件还是原来的版本'
    case LINUX_INSTALL_EXIT.usage:
    case LINUX_INSTALL_EXIT.prepare:
      return '升级辅助程序没能开始安装'
    case LINUX_INSTALL_EXIT.verify:
      return '升级包重新校验没通过（签名、产品或文件不对）'
    case LINUX_INSTALL_EXIT.aptFailed:
      return '系统安装软件包（apt-get）失败：可能缺少依赖，或者系统正在装别的软件'
    case LINUX_INSTALL_EXIT.appStillRunning:
      return '软件没有按时退出，没有安装'
    case LINUX_INSTALL_EXIT.dismissed:
      return '系统授权窗口被关掉了，没有输入管理员密码'
    case LINUX_INSTALL_EXIT.notAuthorized:
      return '没有通过管理员授权：密码不对、账号不是管理员，或者系统里没有授权窗口程序'
    default:
      return `安装过程出错（退出码 ${code}）`
  }
}

/** 能在软件里装时返回 null，不能时返回原因（只对打包好的 Linux 版调用） */
export const linuxInstallUnsupportedReason = (input: {
  execPath: string
  resourcesPath: string
  exists: (file: string) => boolean
}): string | null => {
  if (!input.execPath.startsWith(`${LINUX_INSTALL_PREFIX}/`)) {
    return `软件不是用 deb 安装包装的（在 ${path.posix.dirname(input.execPath)}），只能用安装包升级`
  }
  if (!input.exists(path.posix.join(input.resourcesPath, LINUX_INSTALL_HELPER))) {
    return '安装目录里缺少升级辅助程序，请用安装包重新安装一次'
  }
  if (!input.exists(PKEXEC_PATH)) {
    return '系统里没有 pkexec（Ubuntu 软件包 pkexec 或 policykit-1），装上以后才能在软件里升级'
  }
  if (!input.exists(APT_GET_PATH)) return '系统里没有 apt-get，只支持 Ubuntu / Debian'
  return null
}

/**
 * 软件退出后跑的脚本（普通用户身份，/bin/sh）：等软件退出 → pkexec 跑 root 辅助程序（弹系统授权窗口）
 * → 写退出码 → 重新打开软件（装好了是新版本，没装成还是旧版本，下次启动按退出码说明原因）。
 * pkexec 要求调用它的进程活着，所以由这个脚本调用、等它结束，不能让软件直接调用。
 * 软件 60 秒还没退出就不装（不在软件运行时换程序文件），也不再打开第二个。
 */
export const LINUX_RUNNER_SCRIPT = `pid=$1 ticks=$2 pkexec=$3 helper=$4 pkg=$5 result=$6 log=$7
shift 7
n=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$n" -ge "$ticks" ]; then
    echo "软件（pid $pid）没有退出，没有安装" >"$log"
    echo ${LINUX_INSTALL_EXIT.appStillRunning} >"$result"
    exit 0
  fi
  n=$((n + 1))
  sleep 0.2
done
{
  echo "== $(date '+%Y-%m-%d %H:%M:%S') 安装 $pkg"
  "$pkexec" "$helper" "$pkg"
  code=$?
  echo "== 退出码 $code"
} >"$log" 2>&1
echo "$code" >"$result"
exec "$@" </dev/null >/dev/null 2>&1
`

export type LinuxInstallRequest = {
  /** 要等它退出的软件进程 */
  appPid: number
  waitTicks?: number
  pkexec: string
  helper: string
  /** 存好的升级包目录（manifest.json、manifest.sig、.deb），root 辅助程序会再验一遍 */
  packageDir: string
  /** 写退出码 */
  resultFile: string
  /** pkexec、apt-get 的输出 */
  logFile: string
  /** 装完重新打开软件的命令 */
  relaunch: readonly string[]
}

export const linuxRunnerArgs = (request: LinuxInstallRequest): string[] => [
  '-c',
  LINUX_RUNNER_SCRIPT,
  'yz-update',
  String(request.appPid),
  String(request.waitTicks ?? LINUX_WAIT_EXIT_TICKS),
  request.pkexec,
  request.helper,
  request.packageDir,
  request.resultFile,
  request.logFile,
  ...request.relaunch,
]

export const launchLinuxInstall = async (request: LinuxInstallRequest): Promise<void> => {
  // 上一次留下的退出码不能算到这一次头上
  await fs.rm(request.resultFile, { force: true })
  await fs.mkdir(path.dirname(request.resultFile), { recursive: true })
  await spawnDetached('/bin/sh', linuxRunnerArgs(request))
}
