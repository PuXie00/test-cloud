import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ConfigResult,
  DeviceConfigCatalog,
  MotorModelConfig,
  ObjectModelConfig,
  PlcModelConfig,
} from '../../../shared/config'
import { parseMotorDescription } from './parsers/motor'
import { parseObjectDescription } from './parsers/object'
import { parsePlcDescription } from './parsers/plc'
import { getConfigsRoot } from './paths'

const CATEGORY_DIRS = {
  motors: 'motors',
  plcs: 'plcs',
  objects: 'objects',
} as const

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const listJsonFiles = async (dir: string): Promise<string[]> => {
  if (!(await pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

const readJson = async (filePath: string): Promise<unknown | null> => {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    // Strip UTF-8 BOM (common when files are saved from Windows editors)
    const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    return JSON.parse(normalized) as unknown
  } catch (err) {
    console.warn(`[config] skip invalid JSON: ${filePath}`, err)
    return null
  }
}

const upsertById = <T extends { id: string }>(map: Map<string, T>, item: T, kind: string): void => {
  if (map.has(item.id)) {
    console.warn(`[config] duplicate ${kind} id "${item.id}" — later file wins`)
  }
  map.set(item.id, item)
}

export const loadCatalog = async (
  configsRoot = getConfigsRoot(),
): Promise<ConfigResult<DeviceConfigCatalog>> => {
  if (!(await pathExists(configsRoot))) {
    return { ok: false, error: `Configs root not found: ${configsRoot}` }
  }

  const motorMap = new Map<string, MotorModelConfig>()
  const plcMap = new Map<string, PlcModelConfig>()
  const objectMap = new Map<string, ObjectModelConfig>()

  for (const file of await listJsonFiles(path.join(configsRoot, CATEGORY_DIRS.motors))) {
    const full = path.join(configsRoot, CATEGORY_DIRS.motors, file)
    const raw = await readJson(full)
    if (raw === null) continue
    const base = path.basename(file, path.extname(file))
    const parsed = parseMotorDescription(raw, base)
    if (!parsed) {
      console.warn(`[config] skip unrecognized motor description: ${full}`)
      continue
    }
    upsertById(motorMap, parsed, 'motor')
  }

  for (const file of await listJsonFiles(path.join(configsRoot, CATEGORY_DIRS.plcs))) {
    const full = path.join(configsRoot, CATEGORY_DIRS.plcs, file)
    const raw = await readJson(full)
    if (raw === null) continue
    const base = path.basename(file, path.extname(file))
    const parsed = parsePlcDescription(raw, base)
    if (!parsed) {
      console.warn(`[config] skip unrecognized plc description: ${full}`)
      continue
    }
    upsertById(plcMap, parsed, 'plc')
  }

  for (const file of await listJsonFiles(path.join(configsRoot, CATEGORY_DIRS.objects))) {
    const full = path.join(configsRoot, CATEGORY_DIRS.objects, file)
    const raw = await readJson(full)
    if (raw === null) continue
    const base = path.basename(file, path.extname(file))
    const parsed = parseObjectDescription(raw, base)
    if (!parsed) {
      console.warn(`[config] skip unrecognized object description: ${full}`)
      continue
    }
    upsertById(objectMap, parsed, 'object')
  }

  return {
    ok: true,
    data: {
      motors: [...motorMap.values()],
      plcs: [...plcMap.values()],
      objects: [...objectMap.values()],
    },
  }
}
