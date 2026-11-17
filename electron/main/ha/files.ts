import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isAllowedModelFileName, normalizeModelId } from '../../../shared/project/model-files'
import { getModelsDir, getProjectDir, pathExists } from '../project/paths'
import { getCurrentProjectName } from '../project/service'

/** 模型清单的一项：文件名、内容摘要、大小 */
export type HaModelManifestEntry = { name: string; sha256: string; size: number }

/** 热备传文件用到的工程目录操作（方案 5.6）；写入都是先写临时文件、核对后改名 */
export type HaFilesPort = {
  listModels: () => Promise<HaModelManifestEntry[]>
  readModel: (name: string) => Promise<Buffer | null>
  writeModel: (name: string, data: Buffer, sha256: string) => Promise<boolean>
  deleteModel: (name: string) => Promise<void>
  readCover: () => Promise<{ fileName: string; data: Buffer } | null>
  writeCover: (fileName: string, data: Buffer) => Promise<boolean>
}

export const sha256Of = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/** 只认 Models 目录下的 glb、obj 文件名，不能带路径（另一台发来的名字不能写到别处） */
export const isSafeModelName = (name: string): boolean =>
  typeof name === 'string' && normalizeModelId(name) === `Models/${name}`

const COVER_NAMES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']

/** 写到同一目录的临时文件，核对摘要后改名覆盖：传到一半、写到一半都不会留下半个文件 */
const writeVerified = async (dest: string, data: Buffer, sha256?: string): Promise<boolean> => {
  if (sha256 && sha256Of(data) !== sha256) return false
  const tmp = `${dest}.ha-${randomUUID()}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, dest)
  return true
}

export const createProjectFilesPort = (): HaFilesPort => {
  const modelsDir = (): string | null => {
    const name = getCurrentProjectName()
    return name ? getModelsDir(name) : null
  }
  return {
    listModels: async () => {
      const dir = modelsDir()
      if (!dir || !(await pathExists(dir))) return []
      const result: HaModelManifestEntry[] = []
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !isAllowedModelFileName(entry.name)) continue
        const data = await fs.readFile(path.join(dir, entry.name))
        result.push({ name: entry.name, sha256: sha256Of(data), size: data.byteLength })
      }
      return result.sort((a, b) => a.name.localeCompare(b.name))
    },
    readModel: async (name) => {
      const dir = modelsDir()
      if (!dir || !isSafeModelName(name)) return null
      const file = path.join(dir, name)
      return (await pathExists(file)) ? fs.readFile(file) : null
    },
    writeModel: async (name, data, sha256) => {
      const dir = modelsDir()
      if (!dir || !isSafeModelName(name)) return false
      await fs.mkdir(dir, { recursive: true })
      return writeVerified(path.join(dir, name), data, sha256)
    },
    deleteModel: async (name) => {
      const dir = modelsDir()
      if (!dir || !isSafeModelName(name)) return
      await fs.rm(path.join(dir, name), { force: true })
    },
    readCover: async () => {
      const projectName = getCurrentProjectName()
      if (!projectName) return null
      for (const fileName of COVER_NAMES) {
        const file = path.join(getProjectDir(projectName), fileName)
        if (await pathExists(file)) return { fileName, data: await fs.readFile(file) }
      }
      return null
    },
    writeCover: async (fileName, data) => {
      const projectName = getCurrentProjectName()
      if (!projectName || !COVER_NAMES.includes(fileName)) return false
      const dir = getProjectDir(projectName)
      const ok = await writeVerified(path.join(dir, fileName), data)
      if (!ok) return false
      // 和保存时一样，只留一个封面
      for (const other of COVER_NAMES) {
        if (other !== fileName) await fs.rm(path.join(dir, other), { force: true })
      }
      return true
    },
  }
}
