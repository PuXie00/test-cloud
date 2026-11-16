/**
 * 工程文件（project.json）的格式版本和逐版升级。主进程读文件时用，渲染进程只拿到当前版本。
 *
 * 文件里 schemaVersion 写版本号字符串："1"、"2"…；当前是 "1"（初版）。
 *
 * 什么时候升版本（第一个版本交付现场之后才需要；之前一直是 "1"，改格式不用写升级步骤）：
 * - 只加可选字段（旧软件读到会忽略，缺了有默认值）：不升。
 * - 改结构、改含义、删字段、加必填字段：.env 的 YZ_PROJECT_SCHEMA_VERSION + 1，并在 PROJECT_MIGRATIONS 末尾补一步。
 *
 * 读的时候在内存里逐版升到当前版本，文件不动；保存时才写成新格式，写之前主进程把旧文件备份进 History。
 * 比本软件新的文件（回滚到旧版本后会遇到）不能打开，列表里照常显示。
 */

/** 打包时由 vite.config.ts 从 .env 的 YZ_PROJECT_SCHEMA_VERSION 写进来 */
declare const __YZ_PROJECT_SCHEMA_VERSION__: string | undefined

/** .env 里的版本号；没配是 1，不是正整数直接报错 */
export const parseProjectSchemaVersionSetting = (raw: string | undefined): number => {
  const value = raw?.trim() || '1'
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`YZ_PROJECT_SCHEMA_VERSION 必须是正整数：${value}`)
  return Number(value)
}

/** 当前格式版本（.env 的 YZ_PROJECT_SCHEMA_VERSION） */
export const PROJECT_FORMAT_VERSION = parseProjectSchemaVersionSetting(
  typeof __YZ_PROJECT_SCHEMA_VERSION__ === 'undefined' ? undefined : __YZ_PROJECT_SCHEMA_VERSION__,
)

/** 格式版本 → 文件里的 schemaVersion */
export const toStoredSchemaVersion = (version: number): string => String(version)

/** 文件里的 schemaVersion → 格式版本；认不出来返回 null */
export const readFormatVersion = (schemaVersion: unknown): number | null => {
  const n =
    typeof schemaVersion === 'string' && /^[1-9]\d*$/.test(schemaVersion)
      ? Number(schemaVersion)
      : schemaVersion
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : null
}

export type ProjectDocumentRecord = Record<string, unknown>

/** 第 i 项把版本 i+1 升到 i+2。只认上一版的结构；拿到的是副本，可以直接改 */
export type ProjectMigrationStep = (document: ProjectDocumentRecord) => ProjectDocumentRecord

export const PROJECT_MIGRATIONS: readonly ProjectMigrationStep[] = []

// 升了版本却没写升级步骤：所有旧工程都会打不开，开发时一启动就要发现
if (PROJECT_MIGRATIONS.length !== PROJECT_FORMAT_VERSION - 1) {
  throw new Error(
    `YZ_PROJECT_SCHEMA_VERSION=${PROJECT_FORMAT_VERSION}，但 PROJECT_MIGRATIONS 只写到 v${PROJECT_MIGRATIONS.length + 1}：` +
      '升版本要同时补上对应的升级步骤',
  )
}

export type ProjectFormatOptions = {
  current?: number
  migrations?: readonly ProjectMigrationStep[]
}

export type MigrateProjectResult =
  | {
      ok: true
      document: ProjectDocumentRecord
      /** 文件原来的版本 */
      fromVersion: number
      /** fromVersion 比当前旧，document 是升级后的 */
      migrated: boolean
    }
  | {
      ok: false
      /** TOO_NEW：比本软件新；其余都算读不了 */
      code: 'NOT_AN_OBJECT' | 'UNKNOWN_VERSION' | 'TOO_NEW' | 'MIGRATION_FAILED'
      version: number | null
      message: string
    }

const isRecord = (value: unknown): value is ProjectDocumentRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const tooNewMessage = (version: number, current = PROJECT_FORMAT_VERSION): string =>
  `由更高版本的软件保存（工程格式 v${version}，本软件只支持到 v${current}），请升级软件后再打开`

/** 把任意版本的工程文件内容升到当前版本；不改入参 */
export const migrateProjectDocument = (
  raw: unknown,
  options: ProjectFormatOptions = {},
): MigrateProjectResult => {
  const current = options.current ?? PROJECT_FORMAT_VERSION
  const migrations = options.migrations ?? PROJECT_MIGRATIONS
  if (!isRecord(raw)) {
    return { ok: false, code: 'NOT_AN_OBJECT', version: null, message: '工程文件内容不是对象' }
  }
  const version = readFormatVersion(raw.schemaVersion)
  if (version === null) {
    return {
      ok: false,
      code: 'UNKNOWN_VERSION',
      version: null,
      message: `无法识别的工程格式版本：${JSON.stringify(raw.schemaVersion) ?? 'undefined'}`,
    }
  }
  if (version > current) {
    return { ok: false, code: 'TOO_NEW', version, message: tooNewMessage(version, current) }
  }
  let document: ProjectDocumentRecord = structuredClone(raw)
  for (let from = version; from < current; from += 1) {
    const step = migrations[from - 1]
    try {
      if (!step) throw new Error('缺少这一步的升级程序')
      const next = step(document)
      if (!isRecord(next)) throw new Error('升级程序没有返回对象')
      document = { ...next, schemaVersion: toStoredSchemaVersion(from + 1) }
    } catch (err) {
      return {
        ok: false,
        code: 'MIGRATION_FAILED',
        version,
        message: `工程格式 v${from} → v${from + 1} 升级失败：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
  // 版本号统一成规范写法（手写成数字 1 的也改成 "1"）
  document.schemaVersion = toStoredSchemaVersion(current)
  return { ok: true, document, fromVersion: version, migrated: version < current }
}
