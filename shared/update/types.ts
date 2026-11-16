/**
 * 软件升级：升级包格式和主进程 / 渲染进程之间的契约。
 *
 * 升级包 .yzupd 是一个 zip，顶层三个文件：
 * - manifest.json：UpdateManifest，原样字节就是签名的内容
 * - manifest.sig：manifest.json 的 Ed25519 签名（base64），公钥见 signing-key.ts
 * - 安装程序（manifest.installer.file，NSIS .exe），大小和 sha512 写在 manifest 里
 * 打包：scripts/update-package.mjs。在线更新的服务器上放 latest.json（UpdateLatest）和 .yzupd。
 */
import { isValidVersion } from './version'

export const UPDATE_PACKAGE_EXT = '.yzupd'
export const UPDATE_MANIFEST_FILE = 'manifest.json'
export const UPDATE_SIGNATURE_FILE = 'manifest.sig'
export const UPDATE_LATEST_FILE = 'latest.json'
/** 升级包只给这个产品用，防止装错 */
export const UPDATE_PRODUCT = 'yzapp'

export type UpdateManifest = {
  format: 1
  product: string
  version: string
  /** ISO 时间 */
  releasedAt: string
  /** 更新说明，纯文本 */
  notes: string
  installer: {
    file: string
    size: number
    /** base64 */
    sha512: string
  }
}

/** 服务器上的 latest.json，只是指向升级包；装之前照样验升级包的签名 */
export type UpdateLatest = {
  version: string
  releasedAt: string
  notes: string
  /** 升级包文件名，和 latest.json 放在同一个目录 */
  file: string
  size: number
  /** 升级包整个文件的 sha512（base64） */
  sha512: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 只能是同目录下的文件名，不能带路径 */
const isPlainFileName = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length > 0 &&
  name.length <= 200 &&
  !/[\\/:*?"<>|\x00-\x1f]/.test(name) &&
  name !== '.' &&
  name !== '..'

const isSha512Base64 = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value)

const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const parseUpdateManifest = (value: unknown): UpdateManifest | string => {
  if (!isRecord(value)) return 'manifest 不是对象'
  if (value.format !== 1) return `不认识的升级包格式：${JSON.stringify(value.format)}`
  if (typeof value.product !== 'string' || !value.product) return '缺少 product'
  if (typeof value.version !== 'string' || !isValidVersion(value.version)) {
    return `版本号格式不对：${JSON.stringify(value.version)}`
  }
  if (typeof value.releasedAt !== 'string') return '缺少 releasedAt'
  if (typeof value.notes !== 'string') return '缺少 notes'
  const installer = value.installer
  if (!isRecord(installer)) return '缺少 installer'
  if (!isPlainFileName(installer.file) || !installer.file.toLowerCase().endsWith('.exe')) {
    return `安装程序文件名不对：${JSON.stringify(installer.file)}`
  }
  if (!isSize(installer.size)) return '安装程序大小不对'
  if (!isSha512Base64(installer.sha512)) return '安装程序 sha512 不对'
  return {
    format: 1,
    product: value.product,
    version: value.version,
    releasedAt: value.releasedAt,
    notes: value.notes,
    installer: { file: installer.file, size: installer.size, sha512: installer.sha512 },
  }
}

export const parseUpdateLatest = (value: unknown): UpdateLatest | string => {
  if (!isRecord(value)) return 'latest.json 不是对象'
  if (typeof value.version !== 'string' || !isValidVersion(value.version)) {
    return `版本号格式不对：${JSON.stringify(value.version)}`
  }
  if (!isPlainFileName(value.file) || !value.file.endsWith(UPDATE_PACKAGE_EXT)) {
    return `升级包文件名不对：${JSON.stringify(value.file)}`
  }
  if (!isSize(value.size)) return '升级包大小不对'
  if (!isSha512Base64(value.sha512)) return '升级包 sha512 不对'
  return {
    version: value.version,
    releasedAt: typeof value.releasedAt === 'string' ? value.releasedAt : '',
    notes: typeof value.notes === 'string' ? value.notes : '',
    file: value.file,
    size: value.size,
    sha512: value.sha512,
  }
}

/** 和当前版本比：newer 能升级，current 就是正在用的，older 能回退 */
export type UpdateRelation = 'newer' | 'current' | 'older'

/** 存在数据目录里、验过签名的升级包 */
export type StoredUpdatePackage = {
  version: string
  releasedAt: string
  notes: string
  sizeBytes: number
  relation: UpdateRelation
}

export type UpdateDownloadProgress = {
  version: string
  received: number
  total: number
}

export type UpdateStatus = {
  currentVersion: string
  /** 只有 Windows 安装版能在软件里装 */
  installSupported: boolean
  /** 软件里没有签名公钥时，不能导入、安装任何升级包 */
  signingKeyConfigured: boolean
  /** 在线更新地址（YZ_UPDATE_URL），没配为 null */
  onlineUrl: string | null
  /** 新的在前 */
  packages: StoredUpdatePackage[]
  download: UpdateDownloadProgress | null
}

export type UpdateCheckResult = {
  latest: UpdateLatest
  relation: UpdateRelation
  /** 这个版本的升级包已经在本机了 */
  stored: boolean
}

export type UpdateResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export const UPDATE_CHANNELS = {
  status: 'update:status',
  importPackage: 'update:import',
  check: 'update:check',
  download: 'update:download',
  cancelDownload: 'update:cancel-download',
  install: 'update:install',
  progress: 'update:progress',
} as const
