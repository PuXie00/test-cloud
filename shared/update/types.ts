/**
 * 软件升级：升级包格式和主进程 / 渲染进程之间的契约。
 *
 * 升级包 .yzupd 是一个 zip，顶层三个文件：
 * - manifest.json：UpdateManifest，原样字节就是签名的内容
 * - manifest.sig：manifest.json 的 Ed25519 签名（base64），公钥见 signing-key.ts
 * - 安装程序（manifest.installer.file：Windows 是 NSIS .exe，Linux 是 .deb / .rpm / .AppImage），大小和 sha512 写在 manifest 里
 * 每个升级包只给一种平台 + CPU 架构（如 win32-x64、linux-arm64）用。
 * 打包：scripts/update-package.mjs。在线更新的服务器上放 latest-<平台>-<架构>.json（UpdateLatest）和 .yzupd。
 */
import { isValidVersion } from './version'

export const UPDATE_PACKAGE_EXT = '.yzupd'
export const UPDATE_MANIFEST_FILE = 'manifest.json'
export const UPDATE_SIGNATURE_FILE = 'manifest.sig'
/** 升级包只给这个产品用，防止装错 */
export const UPDATE_PRODUCT = 'yzapp'

/** 平台、CPU 架构，取值同 Node 的 process.platform / process.arch */
export type UpdateTarget = { platform: string; arch: string }

/** 各平台认的安装程序（小写扩展名） */
export const INSTALLER_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  win32: ['.exe'],
  linux: ['.deb', '.rpm', '.appimage'],
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }

/** 给人看的平台名，如「Windows x64」「Linux arm64」 */
export const targetLabel = ({ platform, arch }: UpdateTarget): string =>
  `${PLATFORM_LABELS[platform] ?? platform} ${arch}`

/** 服务器上每种平台 + 架构一个 latest 文件 */
export const latestFileName = ({ platform, arch }: UpdateTarget): string => `latest-${platform}-${arch}.json`

export type UpdateManifest = {
  format: 1
  product: string
  platform: string
  arch: string
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

/** 服务器上的 latest-<平台>-<架构>.json，只是指向升级包；装之前照样验升级包的签名 */
export type UpdateLatest = {
  platform: string
  arch: string
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

const isTargetPart = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9_]{1,20}$/.test(value)

export const parseUpdateManifest = (value: unknown): UpdateManifest | string => {
  if (!isRecord(value)) return 'manifest 不是对象'
  if (value.format !== 1) return `不认识的升级包格式：${JSON.stringify(value.format)}`
  if (typeof value.product !== 'string' || !value.product) return '缺少 product'
  if (!isTargetPart(value.platform) || !isTargetPart(value.arch)) return '缺少平台或 CPU 架构'
  if (typeof value.version !== 'string' || !isValidVersion(value.version)) {
    return `版本号格式不对：${JSON.stringify(value.version)}`
  }
  if (typeof value.releasedAt !== 'string') return '缺少 releasedAt'
  if (typeof value.notes !== 'string') return '缺少 notes'
  const installer = value.installer
  if (!isRecord(installer)) return '缺少 installer'
  const extensions = INSTALLER_EXTENSIONS[value.platform] ?? []
  const file = installer.file
  if (!isPlainFileName(file) || !extensions.some((ext) => file.toLowerCase().endsWith(ext))) {
    return `安装程序文件名不对：${JSON.stringify(file)}`
  }
  if (!isSize(installer.size)) return '安装程序大小不对'
  if (!isSha512Base64(installer.sha512)) return '安装程序 sha512 不对'
  return {
    format: 1,
    product: value.product,
    platform: value.platform,
    arch: value.arch,
    version: value.version,
    releasedAt: value.releasedAt,
    notes: value.notes,
    installer: { file, size: installer.size, sha512: installer.sha512 },
  }
}

export const parseUpdateLatest = (value: unknown): UpdateLatest | string => {
  if (!isRecord(value)) return 'latest 文件不是对象'
  if (!isTargetPart(value.platform) || !isTargetPart(value.arch)) return '缺少平台或 CPU 架构'
  if (typeof value.version !== 'string' || !isValidVersion(value.version)) {
    return `版本号格式不对：${JSON.stringify(value.version)}`
  }
  if (!isPlainFileName(value.file) || !value.file.endsWith(UPDATE_PACKAGE_EXT)) {
    return `升级包文件名不对：${JSON.stringify(value.file)}`
  }
  if (!isSize(value.size)) return '升级包大小不对'
  if (!isSha512Base64(value.sha512)) return '升级包 sha512 不对'
  return {
    platform: value.platform,
    arch: value.arch,
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

/** 选好的升级包文件（还没导入） */
export type UpdatePickedFile = {
  filePath: string
  fileName: string
  sizeBytes: number
}

/**
 * 导入升级包的进度。read：把文件读进本机（U 盘上的包主要慢在这）；extract：解压；verify：校验安装程序。
 * total 为 0 表示这一步没有可报的进度。
 */
export type UpdateImportProgress = {
  fileName: string
  stage: 'read' | 'extract' | 'verify'
  received: number
  total: number
}

export type UpdateStatus = {
  currentVersion: string
  /** 本机的平台和 CPU 架构，只能装同一种的升级包 */
  target: UpdateTarget
  /** 这个平台、这种安装方式能不能在软件里装（开发态都不行） */
  installSupported: boolean
  /** 软件里没有签名公钥时，不能导入、安装任何升级包 */
  signingKeyConfigured: boolean
  /** 在线更新地址（YZ_UPDATE_URL），没配为 null */
  onlineUrl: string | null
  /** 新的在前 */
  packages: StoredUpdatePackage[]
  download: UpdateDownloadProgress | null
  /** 正在导入的升级包（关掉设置再打开也能接着看进度） */
  importing: UpdateImportProgress | null
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
  pickPackage: 'update:pick',
  importPackage: 'update:import',
  importProgress: 'update:import-progress',
  check: 'update:check',
  download: 'update:download',
  cancelDownload: 'update:cancel-download',
  install: 'update:install',
  progress: 'update:progress',
} as const
