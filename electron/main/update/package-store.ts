import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  parseUpdateManifest,
  targetLabel,
  UPDATE_MANIFEST_FILE,
  UPDATE_SIGNATURE_FILE,
  type UpdateImportProgress,
  type UpdateManifest,
  type UpdateResult,
  type UpdateTarget,
} from '../../../shared/update/types'
import { compareVersions } from '../../../shared/update/version'

/**
 * 本机的升级包：<升级目录>/packages/<版本>/ 下放 manifest.json、manifest.sig、安装程序。
 * 导入时完整校验一次（签名、平台和架构、安装程序大小和 sha512），安装 / 回退前再校验一次，防止放在盘上被改或损坏。
 */

export type VerifiedPackage = {
  manifest: UpdateManifest
  installerPath: string
}

/** 导入进度：每一步开始时报一次，读文件、校验时按字节报 */
export type ImportProgressListener = (
  stage: UpdateImportProgress['stage'],
  received: number,
  total: number,
) => void

const ok = <T>(data: T): UpdateResult<T> => ({ ok: true, data })
const fail = <T>(code: string, message: string): UpdateResult<T> => ({ ok: false, code, message })

/** extract-zip 是 CJS，按需 dynamic import（同 project/pack.ts） */
const loadExtractZip = async (): Promise<(zipPath: string, opts: { dir: string }) => Promise<void>> => {
  const mod = await import('extract-zip')
  const extract = (mod as { default?: unknown }).default ?? mod
  return extract as (zipPath: string, opts: { dir: string }) => Promise<void>
}

export const verifyManifestSignature = (
  manifestBytes: Buffer,
  signatureText: string,
  publicKeyPem: string,
): boolean => {
  try {
    const key = createPublicKey(publicKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, manifestBytes, key, Buffer.from(signatureText.trim(), 'base64'))
  } catch {
    return false
  }
}

export const sha512File = (file: string, onBytes?: (done: number) => void): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    let done = 0
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => {
        hash.update(chunk)
        done += chunk.length
        onBytes?.(done)
      })
      .on('end', () => resolve(hash.digest('base64')))
  })

/** 先把选中的文件整个拷进本机临时目录：U 盘、网络盘上的大文件主要慢在读，这一步能报字节进度 */
const copyWithProgress = async (from: string, to: string, onBytes: (done: number) => void): Promise<void> => {
  let done = 0
  await pipeline(
    createReadStream(from),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        done += chunk.length
        onBytes(done)
        callback(null, chunk)
      },
    }),
    createWriteStream(to),
  )
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export class UpdatePackageStore {
  readonly packagesDir: string
  private readonly stagingDir: string

  constructor(
    root: string,
    private readonly publicKeyPem: string,
    private readonly product: string,
    /** 本机的平台和架构，只收同一种的升级包 */
    private readonly target: UpdateTarget,
  ) {
    this.packagesDir = path.join(root, 'packages')
    this.stagingDir = path.join(root, 'staging')
  }

  get signingKeyConfigured(): boolean {
    return this.publicKeyPem.trim().length > 0
  }

  private missingKey<T>(): UpdateResult<T> {
    return fail('NO_SIGNING_KEY', '软件里没有配置升级签名公钥，不能使用升级包')
  }

  /** 读 manifest 并验签名；full 时再验安装程序大小和 sha512 */
  private async verifyDir(
    dir: string,
    full: boolean,
    onVerifyBytes?: (done: number, total: number) => void,
  ): Promise<UpdateResult<VerifiedPackage>> {
    let manifestBytes: Buffer
    let signatureText: string
    try {
      manifestBytes = await fs.readFile(path.join(dir, UPDATE_MANIFEST_FILE))
      signatureText = await fs.readFile(path.join(dir, UPDATE_SIGNATURE_FILE), 'utf8')
    } catch {
      return fail('BAD_PACKAGE', `升级包里缺少 ${UPDATE_MANIFEST_FILE} 或 ${UPDATE_SIGNATURE_FILE}`)
    }
    if (!verifyManifestSignature(manifestBytes, signatureText, this.publicKeyPem)) {
      return fail('BAD_SIGNATURE', '升级包签名不对：不是用本软件的发布密钥签的，或者内容被改过')
    }
    let manifest: UpdateManifest | string
    try {
      manifest = parseUpdateManifest(JSON.parse(manifestBytes.toString('utf8')))
    } catch (err) {
      manifest = errorText(err)
    }
    if (typeof manifest === 'string') return fail('BAD_PACKAGE', `升级包内容不对：${manifest}`)
    if (manifest.product !== this.product) {
      return fail('WRONG_PRODUCT', `这个升级包是给「${manifest.product}」的，不是本软件的`)
    }
    if (manifest.platform !== this.target.platform || manifest.arch !== this.target.arch) {
      return fail(
        'WRONG_PLATFORM',
        `这个升级包是 ${targetLabel(manifest)} 版的，本机是 ${targetLabel(this.target)}，请换对应的升级包`,
      )
    }
    const installerPath = path.join(dir, manifest.installer.file)
    if (full) {
      let size: number
      try {
        size = (await fs.stat(installerPath)).size
      } catch {
        return fail('BAD_PACKAGE', '升级包里缺少安装程序')
      }
      const total = manifest.installer.size
      onVerifyBytes?.(0, total)
      if (
        size !== total ||
        (await sha512File(installerPath, (done) => onVerifyBytes?.(done, total))) !== manifest.installer.sha512
      ) {
        return fail('BAD_INSTALLER', '安装程序校验不对：文件不完整或被改过')
      }
    }
    return ok({ manifest, installerPath })
  }

  /**
   * 导入 .yzupd：读进临时目录、解压、完整校验，通过后放进 packages/<版本>/（同版本的替换掉）。
   * 大文件要好几秒，每一步都通过 onProgress 报出去，界面才不会像卡住了。
   */
  async importPackage(
    file: string,
    onProgress: ImportProgressListener = () => undefined,
  ): Promise<UpdateResult<UpdateManifest>> {
    if (!this.signingKeyConfigured) return this.missingKey()
    let total: number
    try {
      total = (await fs.stat(file)).size
    } catch (err) {
      return fail('READ_FAILED', `读不到升级包文件（${errorText(err)}）`)
    }
    const staging = path.join(this.stagingDir, randomUUID())
    try {
      await fs.mkdir(staging, { recursive: true })
      const localCopy = path.join(staging, 'package.zip')
      onProgress('read', 0, total)
      try {
        await copyWithProgress(path.resolve(file), localCopy, (done) => onProgress('read', done, total))
      } catch (err) {
        return fail('READ_FAILED', `读取升级包失败（${errorText(err)}）`)
      }
      onProgress('extract', 0, 0)
      const files = path.join(staging, 'files')
      try {
        const extractZip = await loadExtractZip()
        await extractZip(localCopy, { dir: files })
      } catch (err) {
        return fail('BAD_PACKAGE', `不是有效的升级包（${errorText(err)}）`)
      }
      await fs.rm(localCopy, { force: true })
      const verified = await this.verifyDir(files, true, (done, size) => onProgress('verify', done, size))
      if (!verified.ok) return verified
      const { manifest } = verified.data
      const dest = path.join(this.packagesDir, manifest.version)
      await fs.rm(dest, { recursive: true, force: true })
      await fs.mkdir(dest, { recursive: true })
      // 只留这三个文件，包里别的东西不要
      for (const name of [UPDATE_MANIFEST_FILE, UPDATE_SIGNATURE_FILE, manifest.installer.file]) {
        await fs.rename(path.join(files, name), path.join(dest, name))
      }
      return ok(manifest)
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** 本机所有验得过签名的升级包，新的在前（不验安装程序，列表要快） */
  async list(): Promise<UpdateManifest[]> {
    if (!this.signingKeyConfigured) return []
    let names: string[]
    try {
      names = await fs.readdir(this.packagesDir)
    } catch {
      return []
    }
    const manifests: UpdateManifest[] = []
    for (const name of names) {
      const verified = await this.verifyDir(path.join(this.packagesDir, name), false)
      if (verified.ok && verified.data.manifest.version === name) manifests.push(verified.data.manifest)
    }
    return manifests.sort((a, b) => compareVersions(b.version, a.version))
  }

  /** 安装前完整校验本机的某个版本 */
  async verifyStored(version: string): Promise<UpdateResult<VerifiedPackage>> {
    if (!this.signingKeyConfigured) return this.missingKey()
    const dir = path.join(this.packagesDir, version)
    if (!(await this.list()).some((m) => m.version === version)) {
      return fail('NOT_FOUND', `本机没有 v${version} 的升级包`)
    }
    return this.verifyDir(dir, true)
  }

  /** 最多留 keep 个升级包（新的优先），当前版本的那个一直留着，回退到别的版本后还能再升回来 */
  async prune(currentVersion: string, keep: number): Promise<void> {
    const manifests = await this.list()
    let kept = 0
    for (const manifest of manifests) {
      if (manifest.version === currentVersion) continue
      kept += 1
      if (kept > keep) {
        await fs.rm(path.join(this.packagesDir, manifest.version), { recursive: true, force: true })
      }
    }
  }
}
