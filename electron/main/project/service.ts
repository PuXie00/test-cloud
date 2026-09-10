import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createEmptyDocument, isProjectDocumentLike } from './empty-document'
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

export const readProjectDocument = async (name: string): Promise<ProjectDocumentLike> => {
  const raw = await fs.readFile(getProjectJsonPath(name), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isProjectDocumentLike(parsed)) {
    throw new Error(`工程配置无效: ${name}`)
  }
  return parsed
}

export const writeProjectDocument = async (
  name: string,
  document: ProjectDocumentLike,
): Promise<void> => {
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

export const buildSummary = async (name: string): Promise<ProjectSummary> => {
  const projectDir = getProjectDir(name)
  const document = await readProjectDocument(name)
  const coverPath = await findCoverPath(projectDir)
  let coverDataUrl: string | null = null
  if (coverPath) {
    try {
      const buf = await fs.readFile(coverPath)
      const ext = path.extname(coverPath).toLowerCase()
      const mime =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png'
      coverDataUrl = `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      coverDataUrl = null
    }
  }
  const setup = document.setup as {
    plcs?: unknown
    motors?: unknown
    controlledObjects?: unknown
  }
  return {
    name,
    id: document.meta.id,
    author: document.meta.author,
    createdAt: document.meta.createdAt,
    modifiedAt: document.meta.modifiedAt,
    status: document.meta.status,
    schemaVersion: document.schemaVersion,
    sizeBytes: await dirSizeBytes(projectDir),
    hasCover: coverPath !== null,
    coverPath,
    coverDataUrl,
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
      if (!entry.isDirectory()) continue
      const jsonPath = getProjectJsonPath(entry.name)
      if (!(await pathExists(jsonPath))) continue
      try {
        summaries.push(await buildSummary(entry.name))
      } catch {
        // 跳过损坏工程目录
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

    await ensureHistoryScaffold(name)
    const document = await readProjectDocument(name)
    currentProjectName = name
    return ok({ summary: await buildSummary(name), document })
  } catch (err) {
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

    const srcDir = getProjectDir(currentProjectName)
    await fs.cp(srcDir, destDir, { recursive: true })

    const document = await readProjectDocument(newName)
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
