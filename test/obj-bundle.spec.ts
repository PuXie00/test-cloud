import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectObjBundle } from '../electron/main/project/obj-bundle'
import { readModelAssets, writeModelAssets } from '../electron/main/project/model-assets'
import { isSafeAssetFileName } from '../shared/project/model-files'
import { mapMtlTextureFiles, parseMtlTextureValue } from '../shared/project/obj-mtl'

/** 「三棱柱」的 GBK 编码（3ds Max 中文系统导出的 OBJ 是这个编码） */
const GBK_PRISM = Buffer.from([0xc8, 0xfd, 0xc0, 0xe2, 0xd6, 0xf9])

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'obj-bundle-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('parseMtlTextureValue', () => {
  it('strips texture options and keeps file names with spaces', () => {
    expect(parseMtlTextureValue('-s 1 1 1 -o 0 0 -clamp on my tex.png')).toEqual({
      file: 'my tex.png',
      bumpMultiplier: null,
    })
    expect(parseMtlTextureValue('-bm 0.3 n.png')).toEqual({ file: 'n.png', bumpMultiplier: '0.3' })
    expect(parseMtlTextureValue('D:\\maps\\a.jpg')).toEqual({ file: 'D:\\maps\\a.jpg', bumpMultiplier: null })
  })

  it('renames texture files in a normalized MTL', () => {
    const text = 'newmtl m\r\nKd 1 1 1\r\nmap_kd wood.png\r\nmap_bump -bm 0.5 n.png\r\n'
    expect(mapMtlTextureFiles(text, (name) => `p-${name}`)).toBe(
      'newmtl m\r\nKd 1 1 1\r\nmap_kd p-wood.png\r\nmap_bump -bm 0.5 p-n.png\r\n',
    )
  })
})

describe('collectObjBundle', () => {
  it('collects a GBK 3ds Max export: mtllib path, textures by file name, missing ones reported', async () => {
    expect(new TextDecoder('gb18030').decode(GBK_PRISM)).toBe('三棱柱')
    const objPath = path.join(dir, '三棱柱A.obj')
    await fs.writeFile(
      objPath,
      Buffer.concat([
        Buffer.from('# 3ds Max\r\nmtllib '),
        GBK_PRISM,
        Buffer.from('\\'),
        GBK_PRISM,
        Buffer.from('A.mtl\r\ng '),
        GBK_PRISM,
        Buffer.from('\r\nusemtl wood\r\nv 0 0 0\r\n'),
      ]),
    )
    await fs.writeFile(
      path.join(dir, '三棱柱A.mtl'),
      [
        'newmtl wood',
        'Kd\t0.5 0.5 0.5',
        'map_Kd D:\\maps\\木纹 1.JPG',
        'bump -bm 0.5 normal.png',
        'map_Ks spec.tif',
        'map_d missing.png',
      ].join('\r\n'),
    )
    await fs.writeFile(path.join(dir, '木纹 1.jpg'), 'jpg')
    await fs.writeFile(path.join(dir, 'normal.png'), 'png')
    await fs.writeFile(path.join(dir, 'spec.tif'), 'tif')

    const bundle = await collectObjBundle(objPath)

    const objText = bundle.obj.toString('utf8')
    expect(objText).toContain('mtllib 三棱柱A.mtl\r\n')
    expect(objText).toContain('g 三棱柱\r\n')
    expect(bundle.mtl?.name).toBe('三棱柱A.mtl')
    expect(bundle.mtl?.text.split('\n')).toEqual([
      'newmtl wood',
      'kd 0.5 0.5 0.5',
      'map_kd 木纹_1.jpg',
      'map_bump -bm 0.5 normal.png',
    ])
    expect(bundle.textures.map((texture) => [texture.name, path.basename(texture.sourcePath), texture.size])).toEqual([
      ['木纹_1.jpg', '木纹 1.jpg', 3],
      ['normal.png', 'normal.png', 3],
    ])
    expect(bundle.missing).toEqual(['spec.tif', 'missing.png'])
    expect([bundle.mtl!.name, ...bundle.textures.map((texture) => texture.name)].every(isSafeAssetFileName)).toBe(true)
  })

  it('merges several mtllib files and uses the same-name MTL when there is no mtllib', async () => {
    const multi = path.join(dir, 'multi.obj')
    await fs.writeFile(multi, 'mtllib a.mtl\nmtllib b.mtl\nv 0 0 0\n')
    await fs.writeFile(path.join(dir, 'a.mtl'), 'newmtl a\nmap_Kd t.png')
    await fs.writeFile(path.join(dir, 'b.mtl'), 'newmtl b\nmap_Kd sub/t.png')
    await fs.mkdir(path.join(dir, 'sub'))
    await fs.writeFile(path.join(dir, 't.png'), 'a')
    await fs.writeFile(path.join(dir, 'sub', 'T.png'), 'b')

    const merged = await collectObjBundle(multi)
    expect(merged.obj.toString('utf8')).toBe('mtllib multi.mtl\n\nv 0 0 0\n')
    expect(merged.mtl?.text).toBe('newmtl a\nmap_kd t.png\nnewmtl b\nmap_kd T_1.png')

    const plain = path.join(dir, 'box.obj')
    await fs.writeFile(plain, 'v 0 0 0\n')
    await fs.writeFile(path.join(dir, 'box.mtl'), 'newmtl box\nKd 1 0 0')
    const sameName = await collectObjBundle(plain)
    expect(sameName.obj.toString('utf8')).toBe('mtllib box.mtl\nv 0 0 0\n')
    expect(sameName.mtl?.text).toBe('newmtl box\nkd 1 0 0')
  })

  it('keeps the OBJ untouched when no MTL is found', async () => {
    const objPath = path.join(dir, 'lonely.obj')
    const raw = Buffer.from('mtllib nowhere.mtl\nv 0 0 0\n')
    await fs.writeFile(objPath, raw)
    const bundle = await collectObjBundle(objPath)
    expect(bundle.obj.equals(raw)).toBe(true)
    expect(bundle.mtl).toBeNull()
    expect(bundle.missing).toEqual(['nowhere.mtl'])
  })
})

describe('model assets directory', () => {
  it('replaces the whole directory and removes it when there are no assets', async () => {
    await writeModelAssets(dir, 'box.obj', [
      { name: 'b.png', data: Buffer.from('b') },
      { name: 'box.mtl', data: Buffer.from('m') },
    ])
    await writeModelAssets(dir, 'box.obj', [{ name: 'box.mtl', data: Buffer.from('m2') }])
    expect((await readModelAssets(dir, 'box.obj')).map((asset) => [asset.name, asset.data.toString()])).toEqual([
      ['box.mtl', 'm2'],
    ])
    await expect(writeModelAssets(dir, 'box.obj', [{ name: '../x.png', data: Buffer.from('x') }])).rejects.toThrow()
    await writeModelAssets(dir, 'box.obj', [])
    expect(await readModelAssets(dir, 'box.obj')).toEqual([])
    expect(await fs.readdir(dir)).toEqual([])
  })
})
