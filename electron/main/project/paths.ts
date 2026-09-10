import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export const PROJECT_JSON = 'project.json'
export const MODELS_DIR = 'Models'
export const HISTORY_DIR = 'History'
export const HISTORY_INDEX = 'index.json'
export const COVER_CANDIDATES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp'] as const

/** Windows / 跨平台非法文件名字符 */
const INVALID_NAME_RE = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED_NAMES = new Set(
  ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)],
)

export const getInstallDir = (): string => path.dirname(app.getPath('exe'))

/** 可通过 YZ_PROJECT_ROOT 覆盖；开发态用 APP_ROOT/Project；打包后用安装目录/Project */
export const getProjectsRoot = (): string => {
  const override = process.env.YZ_PROJECT_ROOT?.trim()
  if (override) return path.resolve(override)
  if (!app.isPackaged) {
    const appRoot = process.env.APP_ROOT?.trim()
    if (appRoot) return path.join(path.resolve(appRoot), 'Project')
  }
  return path.join(getInstallDir(), 'Project')
}

export const getProjectDir = (name: string): string => path.join(getProjectsRoot(), name)

export const getProjectJsonPath = (name: string): string =>
  path.join(getProjectDir(name), PROJECT_JSON)

export const getModelsDir = (name: string): string => path.join(getProjectDir(name), MODELS_DIR)

export const getHistoryDir = (name: string): string => path.join(getProjectDir(name), HISTORY_DIR)

export const getHistoryIndexPath = (name: string): string =>
  path.join(getHistoryDir(name), HISTORY_INDEX)

export const getHistorySnapshotPath = (name: string, historyId: string): string =>
  path.join(getHistoryDir(name), `${historyId}.json`)

export const validateProjectName = (name: string): string | null => {
  const trimmed = name.trim()
  if (!trimmed) return '工程名不能为空'
  if (trimmed.length > 120) return '工程名过长（最多 120 字符）'
  if (trimmed === '.' || trimmed === '..') return '工程名非法'
  if (INVALID_NAME_RE.test(trimmed)) return '工程名包含非法字符'
  if (RESERVED_NAMES.has(trimmed.toUpperCase())) return '工程名为系统保留名'
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return '工程名不能以点或空格结尾'
  return null
}

export const ensureProjectsRoot = async (): Promise<string> => {
  const root = getProjectsRoot()
  await fs.mkdir(root, { recursive: true })
  return root
}

export const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export const findCoverPath = async (projectDir: string): Promise<string | null> => {
  for (const file of COVER_CANDIDATES) {
    const full = path.join(projectDir, file)
    if (await pathExists(full)) return full
  }
  return null
}

export const dirSizeBytes = async (dir: string): Promise<number> => {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full)
    } else if (entry.isFile()) {
      const stat = await fs.stat(full)
      total += stat.size
    }
  }
  return total
}
