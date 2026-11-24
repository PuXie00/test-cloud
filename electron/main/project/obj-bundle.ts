import fs from 'node:fs/promises'
import path from 'node:path'
import { isModelTextureFileName } from '../../../shared/project/model-files'
import {
  formatMtlTextureLine,
  isMtlTextureKey,
  parseMtlLine,
  parseMtlTextureValue,
} from '../../../shared/project/obj-mtl'

export type ObjBundleTexture = { name: string; sourcePath: string; size: number }

export type ObjBundle = {
  /** mtllib 改成合并后的 .mtl（UTF-8）；一个材质文件都没找到时是原文件内容 */
  obj: Buffer
  /** 合并后的材质文件，贴图项只留文件名（附件名） */
  mtl: { name: string; text: string } | null
  textures: ObjBundleTexture[]
  /** 找不到或格式不支持的材质文件、贴图（引用里的文件名） */
  missing: string[]
}

const MTLLIB_LINE = /^[ \t]*mtllib[ \t]+([^\r\n]*?)[ \t]*(\r?)$/gm
const UNSAFE_ASSET_CHAR = /[\\/%#?\s<>:"|*]/
const ASSET_NAME_MAX = 200

/** 和 Babylon 的 OBJ 解析一致：UTF-16 看 BOM，UTF-8 解不开按 GB18030（3ds Max 中文路径） */
export const decodeModelText = (data: Uint8Array): string => {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data)
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('gb18030').decode(data)
  }
}

const stripQuotes = (ref: string): string => ref.trim().replace(/^"(.*)"$/, '$1')

const baseNameOf = (ref: string): string => ref.split(/[\\/]/).pop() ?? ref

const isFile = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

/**
 * 目录里按文件名找，不分大小写（3ds Max 导出的引用常常大小写不一致，Linux 上文件名又区分大小写）；
 * 返回磁盘上的实际文件名，附件按它命名。
 */
const findInDir = async (dir: string, name: string): Promise<string | null> => {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return null
  }
  const lower = name.toLowerCase()
  const hit = entries.find((entry) => entry === name) ?? entries.find((entry) => entry.toLowerCase() === lower)
  return hit && (await isFile(path.join(dir, hit))) ? path.join(dir, hit) : null
}

/** 引用的文件：先按写的路径（相对第一个目录，或绝对路径），再按文件名在各目录里找 */
const resolveSidecar = async (ref: string, dirs: readonly string[]): Promise<string | null> => {
  const asWritten = path.resolve(dirs[0], ref.replace(/[\\/]/g, path.sep))
  const direct = await findInDir(path.dirname(asWritten), path.basename(asWritten))
  if (direct) return direct
  const name = baseNameOf(ref)
  if (!name) return null
  for (const dir of dirs) {
    const found = await findInDir(dir, name)
    if (found) return found
  }
  return null
}

const sanitizeAssetName = (name: string): string => {
  let cleaned = [...name]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || UNSAFE_ASSET_CHAR.test(ch) ? '_' : ch))
    .join('')
    .replace(/\.+$/, '')
  if (cleaned.length > ASSET_NAME_MAX) {
    const ext = path.extname(cleaned).slice(0, 16)
    cleaned = `${cleaned.slice(0, ASSET_NAME_MAX - ext.length)}${ext}`
  }
  return cleaned || 'asset'
}

/** 附件名：去掉不安全字符；不分大小写重名时加 _1、_2 */
const allocateAssetName = (desired: string, used: string[]): string => {
  const base = sanitizeAssetName(desired)
  const taken = new Set(used.map((name) => name.toLowerCase()))
  let name = base
  if (taken.has(name.toLowerCase())) {
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 1
    while (taken.has(`${stem}_${i}${ext}`.toLowerCase())) i += 1
    name = `${stem}_${i}${ext}`
  }
  used.push(name)
  return name
}

const pushUnique = (list: string[], value: string): void => {
  if (value && !list.includes(value)) list.push(value)
}

/** mtllib 的值可以是一个带空格的文件名，也可以是空格隔开的几个文件名 */
const resolveMtllib = async (ref: string, objDir: string, missing: string[]): Promise<string[]> => {
  const whole = await resolveSidecar(ref, [objDir])
  if (whole) return [whole]
  const parts = ref.split(/\s+/).filter(Boolean)
  if (parts.length < 2) {
    pushUnique(missing, baseNameOf(ref))
    return []
  }
  const found: string[] = []
  for (const part of parts) {
    const resolved = await resolveSidecar(part, [objDir])
    if (resolved) found.push(resolved)
    else pushUnique(missing, baseNameOf(part))
  }
  return found
}

/**
 * 收集 OBJ 用到的材质文件和贴图（1.0 的做法是 .obj、.mtl、贴图放在同一个文件夹）：
 * - 按 mtllib 找 .mtl，没写 mtllib 时找同名 .mtl；
 * - 贴图按 MTL 里写的路径找，找不到再按文件名在 MTL、OBJ 所在目录找；
 * - 几个 .mtl 合并成一个（Babylon 只读最后一个 mtllib），贴图项改成附件名。
 */
export const collectObjBundle = async (objPath: string): Promise<ObjBundle> => {
  const raw = await fs.readFile(objPath)
  const objDir = path.dirname(objPath)
  const stem = path.basename(objPath, path.extname(objPath))
  const objText = decodeModelText(raw)
  const missing: string[] = []

  const refs = [...objText.matchAll(MTLLIB_LINE)].map((match) => stripQuotes(match[1]))
  const mtlPaths: string[] = []
  if (refs.length > 0) {
    for (const ref of refs) {
      for (const found of await resolveMtllib(ref, objDir, missing)) {
        if (!mtlPaths.includes(found)) mtlPaths.push(found)
      }
    }
  } else {
    const sameName = await findInDir(objDir, `${stem}.mtl`)
    if (sameName) mtlPaths.push(sameName)
  }
  if (mtlPaths.length === 0) return { obj: raw, mtl: null, textures: [], missing }

  const usedNames: string[] = []
  const mtlName = allocateAssetName(`${stem}.mtl`, usedNames)
  const textures: ObjBundleTexture[] = []
  const textureNameByPath = new Map<string, string>()
  const lines: string[] = []
  for (const mtlPath of mtlPaths) {
    const mtlDir = path.dirname(mtlPath)
    for (const line of decodeModelText(await fs.readFile(mtlPath)).split(/\r?\n/)) {
      const parsed = parseMtlLine(line)
      if (!parsed) {
        lines.push(line)
        continue
      }
      // Babylon 只按第一个空格切关键字，制表符隔开的读不出来
      if (!isMtlTextureKey(parsed.key)) {
        lines.push(parsed.value ? `${parsed.key} ${parsed.value}` : parsed.key)
        continue
      }
      const { file, bumpMultiplier } = parseMtlTextureValue(parsed.value)
      const ref = stripQuotes(file)
      const found = isModelTextureFileName(baseNameOf(ref)) ? await resolveSidecar(ref, [mtlDir, objDir]) : null
      if (!found) {
        pushUnique(missing, baseNameOf(ref))
        continue
      }
      let name = textureNameByPath.get(found)
      if (!name) {
        name = allocateAssetName(path.basename(found), usedNames)
        textureNameByPath.set(found, name)
        textures.push({ name, sourcePath: found, size: (await fs.stat(found)).size })
      }
      lines.push(formatMtlTextureLine(parsed.key, name, bumpMultiplier))
    }
  }

  let firstMtllib = true
  const objOut =
    refs.length > 0
      ? objText.replace(MTLLIB_LINE, (_line, _ref, cr: string) => {
          if (!firstMtllib) return cr
          firstMtllib = false
          return `mtllib ${mtlName}${cr}`
        })
      : `mtllib ${mtlName}\n${objText}`

  return {
    obj: Buffer.from(objOut, 'utf8'),
    mtl: { name: mtlName, text: lines.join('\n') },
    textures,
    missing,
  }
}
