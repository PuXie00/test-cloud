import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  StoredUpdatePackage,
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateManifest,
  UpdateRelation,
  UpdateResult,
  UpdateStatus,
} from '../../../shared/update/types'
import { compareVersions } from '../../../shared/update/version'
import { downloadFile, fetchLatest, type FetchLike } from './online'
import type { UpdatePackageStore } from './package-store'

/** 本机最多留几个升级包（不算当前版本的） */
export const KEEP_PACKAGES = 5

/** NSIS 静默安装，装完自动打开（参数同 electron-updater 的 NsisUpdater） */
export const INSTALLER_ARGS = ['--updated', '/S', '--force-run'] as const

/** 进度最多这么久推一次 */
const PROGRESS_INTERVAL_MS = 250

export type UpdateServiceDeps = {
  currentVersion: string
  /** Windows 安装版才能在软件里装（开发态、Linux 不行） */
  installSupported: boolean
  store: UpdatePackageStore
  /** 在线更新地址，null 表示没配 */
  onlineUrl: string | null
  /** 下载中的文件放这里 */
  downloadsDir: string
  fetch: FetchLike
  /** 有轴在动时返回提示，能装时返回 null（主进程 Info|axis 缓存） */
  motionBlock: () => string | null
  /** 启动安装程序（分离进程，软件退出后它还在） */
  launchInstaller: (installerPath: string, args: readonly string[]) => Promise<void>
  /** 停掉 C++ 运行时和运动学程序，不然安装目录里的文件被占着换不掉 */
  stopRuntimes: () => void
  /** 放开关闭拦截并退出软件 */
  quit: () => void
  /** 下载进度，null 表示下载结束 */
  onProgress: (progress: UpdateDownloadProgress | null) => void
}

const ok = <T>(data: T): UpdateResult<T> => ({ ok: true, data })
const fail = <T>(code: string, message: string): UpdateResult<T> => ({ ok: false, code, message })

export class UpdateService {
  private download: { progress: UpdateDownloadProgress; controller: AbortController } | null = null
  private installing = false

  constructor(private readonly deps: UpdateServiceDeps) {}

  private relationOf(version: string): UpdateRelation {
    const diff = compareVersions(version, this.deps.currentVersion)
    return diff > 0 ? 'newer' : diff < 0 ? 'older' : 'current'
  }

  private toStored(manifest: UpdateManifest): StoredUpdatePackage {
    return {
      version: manifest.version,
      releasedAt: manifest.releasedAt,
      notes: manifest.notes,
      sizeBytes: manifest.installer.size,
      relation: this.relationOf(manifest.version),
    }
  }

  async status(): Promise<UpdateResult<UpdateStatus>> {
    const manifests = await this.deps.store.list()
    return ok({
      currentVersion: this.deps.currentVersion,
      installSupported: this.deps.installSupported,
      signingKeyConfigured: this.deps.store.signingKeyConfigured,
      onlineUrl: this.deps.onlineUrl,
      packages: manifests.map((m) => this.toStored(m)),
      download: this.download?.progress ?? null,
    })
  }

  async importPackage(file: string): Promise<UpdateResult<StoredUpdatePackage>> {
    const imported = await this.deps.store.importPackage(file)
    if (!imported.ok) return imported
    await this.deps.store.prune(this.deps.currentVersion, KEEP_PACKAGES)
    return ok(this.toStored(imported.data))
  }

  async check(): Promise<UpdateResult<UpdateCheckResult>> {
    if (!this.deps.onlineUrl) return fail('NO_SERVER', '没有配置更新服务器（YZ_UPDATE_URL）')
    const latest = await fetchLatest(this.deps.onlineUrl, this.deps.fetch)
    if (!latest.ok) return latest
    const stored = (await this.deps.store.list()).some((m) => m.version === latest.data.version)
    return ok({ latest: latest.data, relation: this.relationOf(latest.data.version), stored })
  }

  /** 下载服务器上的最新版本并导入；本机已经有就直接返回 */
  async downloadLatest(): Promise<UpdateResult<StoredUpdatePackage>> {
    if (this.download) return fail('BUSY', '正在下载')
    const baseUrl = this.deps.onlineUrl
    if (!baseUrl) return fail('NO_SERVER', '没有配置更新服务器（YZ_UPDATE_URL）')
    if (!this.deps.store.signingKeyConfigured) {
      return fail('NO_SIGNING_KEY', '软件里没有配置升级签名公钥，不能使用升级包')
    }
    const checked = await this.check()
    if (!checked.ok) return checked
    const { latest, relation } = checked.data
    if (relation !== 'newer') return fail('NOT_NEWER', `服务器上的 v${latest.version} 不比当前版本新`)
    if (checked.data.stored) {
      const existing = (await this.deps.store.list()).find((m) => m.version === latest.version)
      if (existing) return ok(this.toStored(existing))
    }

    const controller = new AbortController()
    this.download = {
      progress: { version: latest.version, received: 0, total: latest.size },
      controller,
    }
    this.deps.onProgress(this.download.progress)
    const dest = path.join(this.deps.downloadsDir, latest.file)
    let lastPush = 0
    try {
      await fs.mkdir(this.deps.downloadsDir, { recursive: true })
      const downloaded = await downloadFile({
        url: new URL(latest.file, baseUrl).href,
        dest,
        size: latest.size,
        sha512: latest.sha512,
        fetchImpl: this.deps.fetch,
        signal: controller.signal,
        onProgress: (received) => {
          if (!this.download) return
          this.download.progress = { ...this.download.progress, received }
          const now = Date.now()
          if (now - lastPush >= PROGRESS_INTERVAL_MS || received === latest.size) {
            lastPush = now
            this.deps.onProgress(this.download.progress)
          }
        },
      })
      if (!downloaded.ok) return downloaded
      return await this.importPackage(dest)
    } finally {
      await fs.rm(dest, { force: true }).catch(() => undefined)
      this.download = null
      this.deps.onProgress(null)
    }
  }

  cancelDownload(): void {
    this.download?.controller.abort()
  }

  /**
   * 安装本机的某个版本（比当前新是升级，比当前旧是回退）。成功后软件退出，安装程序装完再打开。
   * 有轴在动时不装：要停掉 C++，设备会断开主机。
   */
  async install(version: string): Promise<UpdateResult<null>> {
    if (this.installing) return fail('BUSY', '正在启动安装')
    if (!this.deps.installSupported) return fail('UNSUPPORTED', '只有 Windows 安装版能在软件里升级')
    if (version === this.deps.currentVersion) return fail('SAME_VERSION', `已经是 v${version}`)
    if (this.download) return fail('BUSY', '正在下载升级包，下载完或取消后再安装')
    const verified = await this.deps.store.verifyStored(version)
    if (!verified.ok) return verified
    const blocked = this.deps.motionBlock()
    if (blocked) return fail('AXIS_MOVING', blocked)

    this.installing = true
    try {
      // 先把安装程序拉起来，起不来就什么都不动；它会等软件退出后再卸载旧版本
      await this.deps.launchInstaller(verified.data.installerPath, INSTALLER_ARGS)
    } catch (err) {
      this.installing = false
      return fail('LAUNCH_FAILED', `安装程序没能启动：${err instanceof Error ? err.message : String(err)}`)
    }
    this.deps.stopRuntimes()
    this.deps.quit()
    return ok(null)
  }
}
