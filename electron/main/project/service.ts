import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  migrateProjectDocument,
  PROJECT_FORMAT_VERSION,
  readFormatVersion,
  toStoredSchemaVersion,
} from '../../../shared/project/project-format'
import { createEmptyDocument, isProjectDocumentLike } from './empty-document'
import { appendHistoryEntry } from './history-index'
import {
  MODELS_DIR,
  dirSizeBytes,
  ensureProjectsRoot,
  findCoverPath,
  getHistoryDir,
  getHistoryIndexPath,
  getProjectDir,
  getProjectJsonPath,
  getProjectsRoot,
  pathExists,
  validateProjectName,
} from './paths'
import type {
  CreateProjectParams,
  DeleteProjectParams,
  OpenProjectParams,
  ProjectCompat,
  ProjectDocumentLike,
  ProjectResult,
  ProjectSummary,
  SaveAsProjectParams,
  SaveProjectParams,
} from './types'
import { fail, ok } from './types'

let currentProjectName: string | null = null

const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

export const getCurrentProjectName = (): string | null => currentProjectName

export type ProjectDocumentProblem = 'SCHEMA_TOO_NEW' | 'INVALID_DOCUMENT'

export type ParsedProjectDocument =
  | { ok: true; document: ProjectDocumentLike; formatVersion: number; migrated: boolean }
  | {
      ok: false
      code: ProjectDocumentProblem
      formatVersion: number | null
      message: string
      /** JSON 能解析时的原始内容，列表里取名称、时间显示用 */
      raw?: unknown
    }

/** project.json（或历史快照）文本 → 当前格式的工程文档。旧格式在内存里升级，文件不动 */
export const parseProjectDocument = (text: string): ParsedProjectDocument => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      code: 'INVALID_DOCUMENT',
      formatVersion: null,
      message: `不是有效的 JSON（${err instanceof Error ? err.message : String(err)}）`,
    }
  }
  const migrated = migrateProjectDocument(raw)
  if (!migrated.ok) {
    return {
      ok: false,
      code: migrated.code === 'TOO_NEW' ? 'SCHEMA_TOO_NEW' : 'INVALID_DOCUMENT',
      formatVersion: migrated.version,
      message: migrated.message,
      raw,
    }
  }
  if (!isProjectDocumentLike(migrated.document)) {
    return {
      ok: false,
      code: 'INVALID_DOCUMENT',
      formatVersion: migrated.fromVersion,
      message: '工程配置结构无效',
      raw,
    }
  }
  return {
    ok: true,
    document: migrated.document,
    formatVersion: migrated.fromVersion,
    migrated: migrated.migrated,
  }
}

/** 带错误码的读取失败，IPC 层原样转给界面 */
export class ProjectDocumentError extends Error {
  constructor(
    readonly code: ProjectDocumentProblem,
    message: string,
  ) {
    super(message)
  }
}

export const describeProjectProblem = (
  name: string,
  problem: { code: ProjectDocumentProblem; message: string },
): string =>
  problem.code === 'SCHEMA_TOO_NEW'
    ? `工程「${name}」${problem.message}`
    : `工程「${name}」无法读取：${problem.message}`

/** 读工程，旧格式升到当前格式；比本软件新或读不了时抛 ProjectDocumentError */
export const readProjectDocument = async (name: string): Promise<ProjectDocumentLike> => {
  const parsed = parseProjectDocument(await fs.readFile(getProjectJsonPath(name), 'utf8'))
  if (!parsed.ok) {
    throw new ProjectDocumentError(parsed.code, describeProjectProblem(name, parsed))
  }
  return parsed.document
}

/**
 * 盘上还是旧格式时，写新格式之前把原文件原样备份进 History，名字是「v<当时的软件版本> 升级前自动备份」，
 * 也就是做这次升级的软件版本。写完盘上就是当前格式了，所以每次升级只备份一次。比当前新或读不了的不在这里管。
 */
const backupOlderFormatBeforeWrite = async (name: string): Promise<void> => {
  let text: string
  let version: number | null
  try {
    text = await fs.readFile(getProjectJsonPath(name), 'utf8')
    version = readFormatVersion((JSON.parse(text) as { schemaVersion?: unknown } | null)?.schemaVersion)
  } catch {
    return
  }
  if (version === null || version >= PROJECT_FORMAT_VERSION) return
  await appendHistoryEntry(
    name,
    {
      id: randomUUID(),
      label: `v${app.getVersion()} 升级前自动备份`,
      note: `保存时工程格式从 v${version} 升到 v${PROJECT_FORMAT_VERSION}，这是升级前的原文件`,
      createdAt: new Date().toISOString(),
    },
    text,
  )
}

export const writeProjectDocument = async (
  name: string,
  document: ProjectDocumentLike,
): Promise<void> => {
  await backupOlderFormatBeforeWrite(name)
  const toWrite: ProjectDocumentLike = {
    ...document,
    snapshots: [],
    meta: {
      ...document.meta,
      name,
      modifiedAt: new Date().toISOString(),
    },
  }
  const jsonPath = getProjectJsonPath(name)
  await fs.writeFile(jsonPath, JSON.stringify(toWrite, null, 2), 'utf8')
}

type ProjectInspection = {
  compat: ProjectCompat
  formatVersion: number | null
  message?: string
  /** 能打开时是升到当前格式后的文档；打不开时是能解析出来的原始内容 */
  content: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback

/** 列工程用：看 project.json 能不能被本软件打开，不抛错 */
const inspectProject = async (name: string): Promise<ProjectInspection> => {
  let text: string
  try {
    text = await fs.readFile(getProjectJsonPath(name), 'utf8')
  } catch (err) {
    return {
      compat: 'invalid',
      formatVersion: null,
      message: `此工程无法读取：读不到 project.json（${err instanceof Error ? err.message : String(err)}）`,
      content: null,
    }
  }
  const parsed = parseProjectDocument(text)
  if (parsed.ok) {
    return {
      compat: parsed.migrated ? 'upgrade' : 'ok',
      formatVersion: parsed.formatVersion,
      message: parsed.migrated
        ? `旧格式工程（v${parsed.formatVersion}）。打开后保存会升级到 v${PROJECT_FORMAT_VERSION}，升级前自动备份；升级后旧版本软件打不开`
        : undefined,
      content: parsed.document as unknown as Record<string, unknown>,
    }
  }
  return {
    compat: parsed.code === 'SCHEMA_TOO_NEW' ? 'too-new' : 'invalid',
    formatVersion: parsed.formatVersion,
    message:
      parsed.code === 'SCHEMA_TOO_NEW'
        ? `此工程${parsed.message}`
        : `此工程无法读取：${parsed.message}`,
    content: isRecord(parsed.raw) ? parsed.raw : null,
  }
}

const fileModifiedIso = async (file: string): Promise<string> => {
  try {
    return (await fs.stat(file)).mtime.toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

const readCoverDataUrl = async (coverPath: string | null): Promise<string | null> => {
  if (!coverPath) return null
  try {
    const buf = await fs.readFile(coverPath)
    const ext = path.extname(coverPath).toLowerCase()
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 打不开的工程（版本过高、读不了）也出摘要，名称、时间尽量从原始内容里取 */
export const buildSummary = async (name: string): Promise<ProjectSummary> => {
  const projectDir = getProjectDir(name)
  const inspection = await inspectProject(name)
  const content = recordOf(inspection.content)
  const meta = recordOf(content.meta)
  const setup = recordOf(content.setup)
  const fileTime = await fileModifiedIso(getProjectJsonPath(name))
  const coverPath = await findCoverPath(projectDir)
  return {
    name,
    id: stringOr(meta.id, `folder:${name}`),
    author: stringOr(meta.author, ''),
    createdAt: stringOr(meta.createdAt, fileTime),
    modifiedAt: stringOr(meta.modifiedAt, fileTime),
    status: typeof meta.status === 'string' ? meta.status : undefined,
    schemaVersion:
      inspection.formatVersion === null
        ? String(content.schemaVersion ?? '')
        : toStoredSchemaVersion(inspection.formatVersion),
    formatVersion: inspection.formatVersion,
    compat: inspection.compat,
    compatMessage: inspection.message,
    sizeBytes: await dirSizeBytes(projectDir).catch(() => 0),
    hasCover: coverPath !== null,
    coverPath,
    coverDataUrl: await readCoverDataUrl(coverPath),
    projectPath: projectDir,
    deviceCount: countArray(setup.plcs) + countArray(setup.motors),
    controlledObjectCount: countArray(setup.controlledObjects),
  }
}

const ensureHistoryScaffold = async (name: string): Promise<void> => {
  const historyDir = getHistoryDir(name)
  await fs.mkdir(historyDir, { recursive: true })
  const indexPath = getHistoryIndexPath(name)
  if (!(await pathExists(indexPath))) {
    await fs.writeFile(indexPath, '[]', 'utf8')
  }
}

export const listProjects = async (): Promise<ProjectResult<ProjectSummary[]>> => {
  try {
    const root = await ensureProjectsRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    const summaries: ProjectSummary[] = []
    for (const entry of entries) {
      // .开头的是 C++ 等用的临时目录，不是工程
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const jsonPath = getProjectJsonPath(entry.name)
      if (!(await pathExists(jsonPath))) continue
      try {
        // 版本过高、读不了的工程也列出来（带 compat），不再悄悄跳过
        summaries.push(await buildSummary(entry.name))
      } catch (err) {
        console.error(`[project] 列工程失败: ${entry.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    summaries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    return ok(summaries)
  } catch (err) {
    return fail('LIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const createProject = async (
  params: CreateProjectParams,
): Promise<ProjectResult<ProjectSummary>> => {
  try {
    const nameError = validateProjectName(params.name)
    if (nameError) return fail('INVALID_NAME', nameError)

    const name = params.name.trim()
    await ensureProjectsRoot()
    const projectDir = getProjectDir(name)
    if (await pathExists(projectDir)) {
      return fail('ALREADY_EXISTS', `工程已存在: ${name}`)
    }

    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(path.join(projectDir, MODELS_DIR), { recursive: true })
    await ensureHistoryScaffold(name)

    const document = createEmptyDocument({
      id: randomUUID(),
      name,
      author: params.author?.trim() || 'unknown',
    })
    await writeProjectDocument(name, document)
    currentProjectName = name
    return ok(await buildSummary(name))
  } catch (err) {
    return fail('CREATE_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const openProject = async (
  params: OpenProjectParams,
): Promise<ProjectResult<{ summary: ProjectSummary; document: ProjectDocumentLike }>> => {
  try {
    const nameError = validateProjectName(params.name)
    if (nameError) return fail('INVALID_NAME', nameError)

    const name = params.name.trim()
    if (!(await pathExists(getProjectJsonPath(name)))) {
      return fail('NOT_FOUND', `工程不存在: ${name}`)
    }

    const document = await readProjectDocument(name)
    await ensureHistoryScaffold(name)
    currentProjectName = name
    return ok({ summary: await buildSummary(name), document })
  } catch (err) {
    if (err instanceof ProjectDocumentError) return fail(err.code, err.message)
    return fail('OPEN_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const saveProject = async (
  params: SaveProjectParams,
): Promise<ProjectResult<ProjectSummary>> => {
  try {
    if (!currentProjectName) {
      return fail('NO_CURRENT', '当前没有打开的工程')
    }
    if (!isProjectDocumentLike(params.document)) {
      return fail('INVALID_DOCUMENT', '工程配置结构无效')
    }

    const name = currentProjectName
    await writeProjectDocument(name, params.document)

    const writeCoverFromBase64 = async (raw: string): Promise<void> => {
      const base64 = raw.replace(/^data:image\/png;base64,/i, '')
      const dest = path.join(getProjectDir(name), 'cover.png')
      for (const candidate of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']) {
        const full = path.join(getProjectDir(name), candidate)
        if (await pathExists(full)) {
          try {
            await fs.unlink(full)
          } catch {
            // ignore
          }
        }
      }
      await fs.writeFile(dest, Buffer.from(base64, 'base64'))
    }

    if (params.coverPngBase64?.trim()) {
      await writeCoverFromBase64(params.coverPngBase64.trim())
    } else if (params.coverPath) {
      const ext = path.extname(params.coverPath).toLowerCase() || '.png'
      const allowed = ['.png', '.jpg', '.jpeg', '.webp']
      if (!allowed.includes(ext)) {
        return fail('INVALID_COVER', `不支持的封面格式: ${ext}`)
      }
      const dest = path.join(getProjectDir(name), `cover${ext === '.jpeg' ? '.jpg' : ext}`)
      // 清理其他封面候选
      for (const candidate of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']) {
        const full = path.join(getProjectDir(name), candidate)
        if (await pathExists(full)) {
          try {
            await fs.unlink(full)
          } catch {
            // ignore
          }
        }
      }
      await fs.copyFile(params.coverPath, dest)
    }

    return ok(await buildSummary(name))
  } catch (err) {
    return fail('SAVE_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const saveProjectAs = async (
  params: SaveAsProjectParams,
): Promise<ProjectResult<ProjectSummary>> => {
  try {
    if (!currentProjectName) {
      return fail('NO_CURRENT', '当前没有打开的工程')
    }

    const nameError = validateProjectName(params.newName)
    if (nameError) return fail('INVALID_NAME', nameError)

    const newName = params.newName.trim()
    if (newName === currentProjectName) {
      return fail('SAME_NAME', '另存为名称与当前工程相同')
    }

    const destDir = getProjectDir(newName)
    if (await pathExists(destDir)) {
      return fail('ALREADY_EXISTS', `工程已存在: ${newName}`)
    }

    // 先读源工程（旧格式在这里升级），读不了就不拷
    const document = await readProjectDocument(currentProjectName)
    const srcDir = getProjectDir(currentProjectName)
    await fs.cp(srcDir, destDir, { recursive: true })

    document.meta.id = randomUUID()
    document.meta.name = newName
    document.meta.createdAt = new Date().toISOString()
    await writeProjectDocument(newName, document)

    currentProjectName = newName
    return ok(await buildSummary(newName))
  } catch (err) {
    return fail('SAVE_AS_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const deleteProject = async (
  params: DeleteProjectParams,
): Promise<ProjectResult<null>> => {
  try {
    const nameError = validateProjectName(params.name)
    if (nameError) return fail('INVALID_NAME', nameError)

    const name = params.name.trim()
    const projectDir = getProjectDir(name)
    if (!(await pathExists(projectDir))) {
      return fail('NOT_FOUND', `工程不存在: ${name}`)
    }

    // 防止路径逃逸：必须在 Project 根下
    const root = path.resolve(getProjectsRoot())
    const resolved = path.resolve(projectDir)
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      return fail('INVALID_PATH', '非法工程路径')
    }

    if (currentProjectName === name) {
      currentProjectName = null
    }

    await fs.rm(projectDir, { recursive: true, force: true })
    return ok(null)
  } catch (err) {
    return fail('DELETE_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const closeProject = async (): Promise<ProjectResult<null>> => {
  currentProjectName = null
  return ok(null)
}

/** 供 history/pack 使用：确保工程目录具备标准子目录 */
export const ensureProjectScaffold = async (name: string): Promise<void> => {
  await fs.mkdir(path.join(getProjectDir(name), MODELS_DIR), { recursive: true })
  await ensureHistoryScaffold(name)
}
