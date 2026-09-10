import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  MODEL_MAX_BYTES,
  MODELS_PREFIX,
  allocateUniqueFileName,
  isAllowedModelFileName,
  normalizeModelId,
} from '../../../shared/project/model-files'
import { getModelsDir, pathExists } from './paths'
import { getCurrentProjectName, readProjectDocument } from './service'
import type { ProjectResult } from './types'
import { fail, ok } from './types'

export type ProjectModelEntry = {
  modelId: string
  fileName: string
  ext: string
  sizeBytes: number
}

export type ImportModelParams = {
  sourcePath?: string
}

export type DeleteModelParams = {
  modelId: string
}

export type ReadModelParams = {
  modelId: string
}

export type ReadModelData = {
  data: ArrayBuffer
  fileName: string
  ext: string
}

const getParentWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

const requireOpenProject = (): ProjectResult<string> => {
  const name = getCurrentProjectName()?.trim()
  if (!name) return fail('NO_PROJECT', '请先打开工程')
  return ok(name)
}

const ensureModelsDir = async (projectName: string): Promise<string> => {
  const dir = getModelsDir(projectName)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const extWithoutDot = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase()
  return ext.startsWith('.') ? ext.slice(1) : ext
}

const toEntry = (fileName: string, sizeBytes: number): ProjectModelEntry => ({
  modelId: `${MODELS_PREFIX}${fileName}`,
  fileName,
  ext: extWithoutDot(fileName),
  sizeBytes,
})

const bufferToArrayBuffer = (buf: Buffer): ArrayBuffer => {
  const copy = new Uint8Array(buf.byteLength)
  copy.set(buf)
  return copy.buffer
}

const countModelReferences = async (
  projectName: string,
  modelId: string,
): Promise<number> => {
  const document = await readProjectDocument(projectName)
  const setup = document.setup as { controlledObjects?: unknown }
  const objects = Array.isArray(setup.controlledObjects) ? setup.controlledObjects : []
  let count = 0
  for (const item of objects) {
    if (!item || typeof item !== 'object') continue
    if ((item as { modelId?: unknown }).modelId === modelId) count += 1
  }
  return count
}

const pickSourcePath = async (sourcePath?: string): Promise<ProjectResult<string>> => {
  if (sourcePath?.trim()) return ok(sourcePath.trim())

  const win = getParentWindow()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: '导入模型',
        properties: ['openFile'],
        filters: [
          { name: '3D 模型', extensions: ['glb', 'obj'] },
          { name: 'GLB', extensions: ['glb'] },
          { name: 'OBJ', extensions: ['obj'] },
        ],
      })
    : await dialog.showOpenDialog({
        title: '导入模型',
        properties: ['openFile'],
        filters: [
          { name: '3D 模型', extensions: ['glb', 'obj'] },
          { name: 'GLB', extensions: ['glb'] },
          { name: 'OBJ', extensions: ['obj'] },
        ],
      })

  if (result.canceled || result.filePaths.length === 0) {
    return fail('CANCELLED', '用户取消导入')
  }
  return ok(result.filePaths[0])
}

export const listModels = async (): Promise<ProjectResult<ProjectModelEntry[]>> => {
  try {
    const project = requireOpenProject()
    if (!project.ok) return project

    const modelsDir = await ensureModelsDir(project.data)
    if (!(await pathExists(modelsDir))) return ok([])

    const entries = await fs.readdir(modelsDir, { withFileTypes: true })
    const models: ProjectModelEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!isAllowedModelFileName(entry.name)) continue
      const full = path.join(modelsDir, entry.name)
      const stat = await fs.stat(full)
      models.push(toEntry(entry.name, stat.size))
    }
    models.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN'))
    return ok(models)
  } catch (err) {
    return fail('MODELS_LIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const importModel = async (
  params: ImportModelParams = {},
): Promise<ProjectResult<ProjectModelEntry>> => {
  try {
    const project = requireOpenProject()
    if (!project.ok) return project

    const picked = await pickSourcePath(params.sourcePath)
    if (!picked.ok) return picked

    const sourcePath = picked.data
    const baseName = path.basename(sourcePath)
    if (!isAllowedModelFileName(baseName)) {
      return fail('INVALID_FORMAT', '仅支持 GLB、OBJ')
    }

    const stat = await fs.stat(sourcePath)
    if (!stat.isFile()) return fail('INVALID_FORMAT', '仅支持 GLB、OBJ')
    if (stat.size > MODEL_MAX_BYTES) {
      return fail('TOO_LARGE', '文件不能超过 10MB')
    }

    const modelsDir = await ensureModelsDir(project.data)
    const existing = (await fs.readdir(modelsDir)).filter((name) => isAllowedModelFileName(name))
    const fileName = allocateUniqueFileName(baseName, existing)
    const destPath = path.join(modelsDir, fileName)
    await fs.copyFile(sourcePath, destPath)

    return ok(toEntry(fileName, stat.size))
  } catch (err) {
    return fail('MODELS_IMPORT_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const deleteModel = async (
  params: DeleteModelParams,
): Promise<ProjectResult<null>> => {
  try {
    const project = requireOpenProject()
    if (!project.ok) return project

    const modelId = normalizeModelId(params.modelId ?? '')
    if (!modelId) return fail('INVALID_MODEL_ID', '模型路径非法')

    const refCount = await countModelReferences(project.data, modelId)
    if (refCount > 0) {
      return fail('IN_USE', `${refCount} 个物体正在使用`)
    }

    const fileName = modelId.slice(MODELS_PREFIX.length)
    const fullPath = path.join(getModelsDir(project.data), fileName)
    if (!(await pathExists(fullPath))) {
      return fail('NOT_FOUND', `模型不存在: ${fileName}`)
    }
    await fs.unlink(fullPath)
    return ok(null)
  } catch (err) {
    return fail('MODELS_DELETE_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const readModel = async (
  params: ReadModelParams,
): Promise<ProjectResult<ReadModelData>> => {
  try {
    const project = requireOpenProject()
    if (!project.ok) return project

    const modelId = normalizeModelId(params.modelId ?? '')
    if (!modelId) return fail('INVALID_MODEL_ID', '模型路径非法')

    const fileName = modelId.slice(MODELS_PREFIX.length)
    const fullPath = path.join(getModelsDir(project.data), fileName)
    if (!(await pathExists(fullPath))) {
      return fail('NOT_FOUND', `模型不存在: ${fileName}`)
    }

    const buf = await fs.readFile(fullPath)
    return ok({
      data: bufferToArrayBuffer(buf),
      fileName,
      ext: extWithoutDot(fileName),
    })
  } catch (err) {
    return fail('MODELS_READ_FAILED', err instanceof Error ? err.message : String(err))
  }
}
