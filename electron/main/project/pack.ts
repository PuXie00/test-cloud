import { BrowserWindow, dialog } from 'electron'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  HISTORY_DIR,
  PROJECT_JSON,
  ensureProjectsRoot,
  getProjectDir,
  getProjectJsonPath,
  getProjectsRoot,
  pathExists,
  validateProjectName,
} from './paths'
import { isProjectDocumentLike } from './empty-document'
import {
  buildSummary,
  ensureProjectScaffold,
  getCurrentProjectName,
  readProjectDocument,
  writeProjectDocument,
} from './service'
import type {
  ExportProjectParams,
  ImportProjectParams,
  ProjectResult,
  ProjectSummary,
} from './types'
import { fail, ok } from './types'

type ZipArchiveCtor = new (options?: { zlib?: { level?: number } }) => {
  file: (filePath: string, data: { name: string }) => void
  pipe: (stream: NodeJS.WritableStream) => void
  finalize: () => Promise<void> | void
  on: (event: string, cb: (err: Error) => void) => void
}

/** archiver@8 为纯 ESM（ZipArchive 类），禁止 createRequire；按需 dynamic import */
const loadZipArchive = async (): Promise<ZipArchiveCtor> => {
  const mod = await import('archiver')
  return mod.ZipArchive as ZipArchiveCtor
}

/** extract-zip 为 CJS，同样用 dynamic import 避免打包期 require ESM 问题 */
const loadExtractZip = async (): Promise<
  (zipPath: string, opts: { dir: string }) => Promise<void>
> => {
  const mod = await import('extract-zip')
  const extract = (mod as { default?: unknown }).default ?? mod
  return extract as (zipPath: string, opts: { dir: string }) => Promise<void>
}

const getParentWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

const zipProjectExcludingHistory = async (
  projectDir: string,
  destZip: string,
): Promise<void> => {
  const ZipArchive = await loadZipArchive()
  await fs.mkdir(path.dirname(destZip), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destZip)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)

    archive.pipe(output)

    const appendDir = async (dir: string, zipPrefix: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === HISTORY_DIR && zipPrefix === '') continue
        const full = path.join(dir, entry.name)
        const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await appendDir(full, zipPath)
        } else if (entry.isFile()) {
          archive.file(full, { name: zipPath })
        }
      }
    }

    appendDir(projectDir, '')
      .then(() => archive.finalize())
      .catch(reject)
  })
}

const findProjectJsonRoot = async (dir: string): Promise<string | null> => {
  const direct = path.join(dir, PROJECT_JSON)
  if (await pathExists(direct)) return dir

  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = path.join(dir, entry.name, PROJECT_JSON)
    if (await pathExists(nested)) return path.join(dir, entry.name)
  }
  return null
}

const allocateImportName = async (baseName: string): Promise<string> => {
  const root = getProjectsRoot()
  let candidate = `${baseName}_imported`
  if (!(await pathExists(path.join(root, candidate)))) return candidate
  let i = 2
  while (await pathExists(path.join(root, `${baseName}_imported_${i}`))) {
    i += 1
  }
  return `${baseName}_imported_${i}`
}

export const exportProject = async (
  params: ExportProjectParams = {},
): Promise<ProjectResult<{ filePath: string }>> => {
  try {
    const name = (params.name ?? getCurrentProjectName())?.trim()
    if (!name) return fail('NO_CURRENT', '当前没有打开的工程，且未指定工程名')
    const nameError = validateProjectName(name)
    if (nameError) return fail('INVALID_NAME', nameError)

    if (!(await pathExists(getProjectJsonPath(name)))) {
      return fail('NOT_FOUND', `工程不存在: ${name}`)
    }

    const win = getParentWindow()
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: '导出工程',
          defaultPath: `${name}.yzproj`,
          filters: [{ name: '岳中工程包', extensions: ['yzproj'] }],
        })
      : await dialog.showSaveDialog({
          title: '导出工程',
          defaultPath: `${name}.yzproj`,
          filters: [{ name: '岳中工程包', extensions: ['yzproj'] }],
        })

    if (result.canceled || !result.filePath) {
      return fail('CANCELLED', '用户取消导出')
    }

    const filePath = result.filePath.endsWith('.yzproj')
      ? result.filePath
      : `${result.filePath}.yzproj`

    await zipProjectExcludingHistory(getProjectDir(name), filePath)
    return ok({ filePath })
  } catch (err) {
    return fail('EXPORT_FAILED', err instanceof Error ? err.message : String(err))
  }
}

export const importProject = async (
  params: ImportProjectParams = {},
): Promise<ProjectResult<ProjectSummary>> => {
  const tempRoot = path.join(os.tmpdir(), `yz-project-import-${randomUUID()}`)
  try {
    const win = getParentWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '导入工程',
          properties: ['openFile'],
          filters: [{ name: '岳中工程包', extensions: ['yzproj', 'zip'] }],
        })
      : await dialog.showOpenDialog({
          title: '导入工程',
          properties: ['openFile'],
          filters: [{ name: '岳中工程包', extensions: ['yzproj', 'zip'] }],
        })

    if (result.canceled || result.filePaths.length === 0) {
      return fail('CANCELLED', '用户取消导入')
    }

    const zipPath = result.filePaths[0]
    await fs.mkdir(tempRoot, { recursive: true })
    const extractZip = await loadExtractZip()
    await extractZip(zipPath, { dir: tempRoot })

    const contentRoot = await findProjectJsonRoot(tempRoot)
    if (!contentRoot) {
      return fail('INVALID_PACKAGE', '工程包中缺少 project.json')
    }

    const raw = await fs.readFile(path.join(contentRoot, PROJECT_JSON), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isProjectDocumentLike(parsed)) {
      return fail('INVALID_DOCUMENT', '工程配置结构无效')
    }

    let targetName = (parsed.meta.name || path.basename(contentRoot)).trim()
    const nameError = validateProjectName(targetName)
    if (nameError) {
      targetName = `imported_${Date.now()}`
    }

    await ensureProjectsRoot()
    let renamedAsImport = false
    const destDir = getProjectDir(targetName)
    if (await pathExists(destDir)) {
      if (params.overwrite === true) {
        await fs.rm(destDir, { recursive: true, force: true })
      } else {
        const conflict = win
          ? await dialog.showMessageBox(win, {
              type: 'warning',
              title: '工程已存在',
              message: `工程「${targetName}」已存在。`,
              detail: '覆盖将替换本地工程；另存为将使用新名称与新 ID。',
              buttons: ['覆盖', '另存为', '取消'],
              defaultId: 2,
              cancelId: 2,
              noLink: true,
            })
          : await dialog.showMessageBox({
              type: 'warning',
              title: '工程已存在',
              message: `工程「${targetName}」已存在。`,
              detail: '覆盖将替换本地工程；另存为将使用新名称与新 ID。',
              buttons: ['覆盖', '另存为', '取消'],
              defaultId: 2,
              cancelId: 2,
              noLink: true,
            })

        if (conflict.response === 2) {
          return fail('CANCELLED', '用户取消导入')
        }
        if (conflict.response === 0) {
          await fs.rm(destDir, { recursive: true, force: true })
        } else {
          targetName = await allocateImportName(targetName)
          renamedAsImport = true
        }
      }
    }

    await fs.cp(contentRoot, getProjectDir(targetName), { recursive: true })
    // 确保不带入 History；若包内误含则删除
    const importedHistory = path.join(getProjectDir(targetName), HISTORY_DIR)
    if (await pathExists(importedHistory)) {
      await fs.rm(importedHistory, { recursive: true, force: true })
    }
    await ensureProjectScaffold(targetName)

    const document = await readProjectDocument(targetName)
    document.meta.name = targetName
    document.meta.id = renamedAsImport
      ? randomUUID()
      : document.meta.id || randomUUID()
    document.snapshots = []
    await writeProjectDocument(targetName, document)

    return ok(await buildSummary(targetName))
  } catch (err) {
    return fail('IMPORT_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}
