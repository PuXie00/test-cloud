import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isSafeAssetFileName, modelAssetsDirName } from '../../../shared/project/model-files'

/** 模型附件（OBJ 的 .mtl、贴图），放在 Models/<模型文件名>.assets/ 下 */
export type ModelAssetFile = { name: string; data: Buffer }

const assetsDirOf = (modelsDir: string, fileName: string): string =>
  path.join(modelsDir, modelAssetsDirName(fileName))

/** 附件名按 UTF-16 码元排序：两台机器上的顺序一致，模型包摘要才一致 */
const listAssetNames = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isSafeAssetFileName(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

export const readModelAssets = async (modelsDir: string, fileName: string): Promise<ModelAssetFile[]> => {
  const dir = assetsDirOf(modelsDir, fileName)
  const names = await listAssetNames(dir)
  return Promise.all(names.map(async (name) => ({ name, data: await fs.readFile(path.join(dir, name)) })))
}

export const getModelAssetsSize = async (modelsDir: string, fileName: string): Promise<number> => {
  const dir = assetsDirOf(modelsDir, fileName)
  let total = 0
  for (const name of await listAssetNames(dir)) {
    total += (await fs.stat(path.join(dir, name))).size
  }
  return total
}

export const removeModelAssets = async (modelsDir: string, fileName: string): Promise<void> => {
  await fs.rm(assetsDirOf(modelsDir, fileName), { recursive: true, force: true })
}

const writeFileSynced = async (file: string, data: Buffer): Promise<void> => {
  const handle = await fs.open(file, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** 整个附件目录一起换：先写到临时目录，写完再替换旧目录；没有附件就删掉旧目录 */
export const writeModelAssets = async (
  modelsDir: string,
  fileName: string,
  assets: readonly ModelAssetFile[],
): Promise<void> => {
  const dir = assetsDirOf(modelsDir, fileName)
  if (assets.length === 0) {
    await fs.rm(dir, { recursive: true, force: true })
    return
  }
  const lowerNames = new Set(assets.map((asset) => asset.name.toLowerCase()))
  if (lowerNames.size !== assets.length || !assets.every((asset) => isSafeAssetFileName(asset.name))) {
    throw new Error(`模型 ${fileName} 的附件文件名非法`)
  }
  const tmp = `${dir}.tmp-${randomUUID()}`
  await fs.mkdir(tmp, { recursive: true })
  try {
    for (const asset of assets) await writeFileSynced(path.join(tmp, asset.name), asset.data)
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rename(tmp, dir)
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  }
}
