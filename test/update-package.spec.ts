import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UpdatePackageStore } from '../electron/main/update/package-store'
import { compareVersions, isValidVersion } from '../shared/update/version'
import { parseUpdateLatest, UPDATE_PRODUCT } from '../shared/update/types'
// @ts-expect-error 发版脚本是 .mjs，没有类型
import * as tool from '../scripts/update-package.mjs'

type Keys = { publicKeyPem: string; privateKeyPem: string }

describe('compareVersions', () => {
  it('orders versions like semver', () => {
    const sorted = ['1.10.0', '1.2.0', '1.2.0-beta.2', '1.2.0-beta.10', '1.2.0-alpha', '0.9.9', '2.0.0', '1.2.1']
    sorted.sort(compareVersions)
    expect(sorted).toEqual([
      '0.9.9',
      '1.2.0-alpha',
      '1.2.0-beta.2',
      '1.2.0-beta.10',
      '1.2.0',
      '1.2.1',
      '1.10.0',
      '2.0.0',
    ])
    expect(compareVersions('1.2.0+build.5', '1.2.0')).toBe(0)
  })

  it('validates the format', () => {
    expect(isValidVersion('1.0.0')).toBe(true)
    expect(isValidVersion('1.0')).toBe(false)
    expect(isValidVersion('../1.0.0')).toBe(false)
    expect(() => compareVersions('x', '1.0.0')).toThrow()
  })
})

describe('update package', () => {
  let tmp: string
  let keys: Keys
  let installer: string
  let store: UpdatePackageStore

  const pack = (version: string, overrides: Record<string, unknown> = {}) =>
    tool.packUpdate({
      installer,
      privateKeyPem: keys.privateKeyPem,
      version,
      notes: `v${version} 更新说明\n第二行`,
      releasedAt: '2026-11-20T08:00:00.000Z',
      outDir: path.join(tmp, 'out', version),
      ...overrides,
    }) as Promise<{ packagePath: string; latestPath: string }>

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-update-'))
    keys = tool.generateSigningKeys()
    installer = path.join(tmp, 'yzapp_setup.exe')
    await fs.writeFile(installer, Buffer.alloc(300_000, 7))
    store = new UpdatePackageStore(path.join(tmp, 'Updates'), keys.publicKeyPem, UPDATE_PRODUCT)
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('imports a signed package and keeps only the three files', async () => {
    const { packagePath, latestPath } = await pack('1.2.0')

    const imported = await store.importPackage(packagePath)

    expect(imported).toMatchObject({ ok: true, data: { version: '1.2.0', notes: 'v1.2.0 更新说明\n第二行' } })
    expect((await fs.readdir(path.join(store.packagesDir, '1.2.0'))).sort()).toEqual([
      'manifest.json',
      'manifest.sig',
      'yzapp_setup.exe',
    ])
    expect((await store.list()).map((m) => m.version)).toEqual(['1.2.0'])
    const verified = await store.verifyStored('1.2.0')
    expect(verified.ok && (await fs.readFile(verified.data.installerPath)).length).toBe(300_000)
    // 临时目录用完就删
    expect(await fs.readdir(path.join(tmp, 'Updates', 'staging'))).toEqual([])
    // latest.json 能被软件读懂
    expect(typeof parseUpdateLatest(JSON.parse(await fs.readFile(latestPath, 'utf8')))).toBe('object')
  })

  it('rejects packages signed with another key', async () => {
    const other = tool.generateSigningKeys()
    const { packagePath } = await pack('1.2.0', { privateKeyPem: other.privateKeyPem })
    expect(await store.importPackage(packagePath)).toMatchObject({ ok: false, code: 'BAD_SIGNATURE' })
    expect(await store.list()).toEqual([])
  })

  it('rejects packages for another product', async () => {
    const { packagePath } = await pack('1.2.0', { product: 'other-app' })
    expect(await store.importPackage(packagePath)).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' })
  })

  it('rejects files that are not packages', async () => {
    const junk = path.join(tmp, 'junk.yzupd')
    await fs.writeFile(junk, 'not a zip')
    expect(await store.importPackage(junk)).toMatchObject({ ok: false, code: 'BAD_PACKAGE' })
  })

  it('catches an installer swapped inside the package', async () => {
    const { packagePath } = await pack('1.2.0')
    const unpacked = path.join(tmp, 'unpacked')
    const { default: extractZip } = await import('extract-zip')
    await extractZip(packagePath, { dir: unpacked })
    await fs.writeFile(path.join(unpacked, 'yzapp_setup.exe'), Buffer.alloc(300_000, 9))
    const { ZipArchive } = await import('archiver')
    const forged = path.join(tmp, 'forged.yzupd')
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(forged)
      const archive = new ZipArchive()
      output.on('close', () => resolve())
      archive.on('error', reject)
      archive.pipe(output)
      for (const name of ['manifest.json', 'manifest.sig', 'yzapp_setup.exe']) {
        archive.file(path.join(unpacked, name), { name })
      }
      void archive.finalize()
    })

    expect(await store.importPackage(forged)).toMatchObject({ ok: false, code: 'BAD_INSTALLER' })
    expect(await store.list()).toEqual([])
  })

  it('checks the installer again before installing', async () => {
    const { packagePath } = await pack('1.2.0')
    expect((await store.importPackage(packagePath)).ok).toBe(true)
    const stored = path.join(store.packagesDir, '1.2.0', 'yzapp_setup.exe')
    const bytes = await fs.readFile(stored)
    bytes[100] ^= 0xff
    await fs.writeFile(stored, bytes)

    expect(await store.verifyStored('1.2.0')).toMatchObject({ ok: false, code: 'BAD_INSTALLER' })
  })

  it('refuses everything without a public key', async () => {
    const { packagePath } = await pack('1.2.0')
    const noKey = new UpdatePackageStore(path.join(tmp, 'Updates2'), '', UPDATE_PRODUCT)
    expect(noKey.signingKeyConfigured).toBe(false)
    expect(await noKey.importPackage(packagePath)).toMatchObject({ ok: false, code: 'NO_SIGNING_KEY' })
  })

  it('replaces the same version and prunes old packages but keeps the current one', async () => {
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) {
      expect((await store.importPackage((await pack(version)).packagePath)).ok).toBe(true)
    }
    expect((await store.importPackage((await pack('1.2.0')).packagePath)).ok).toBe(true)

    await store.prune('1.0.0', 2)

    expect((await store.list()).map((m) => m.version)).toEqual(['1.3.0', '1.2.0', '1.0.0'])
  })

  it('keygen writes the public key into the source constant', () => {
    const empty = "export const UPDATE_SIGNING_PUBLIC_KEY = ''\n"
    expect(tool.readPublicKeyConstant(empty)).toBe('')
    const written = tool.writePublicKeyConstant(empty, keys.publicKeyPem)
    expect(tool.readPublicKeyConstant(written)).toBe(keys.publicKeyPem.trim())
    expect(tool.publicKeyOf(keys.privateKeyPem)).toBe(keys.publicKeyPem)
    // 再换一次也能找到
    const again = tool.writePublicKeyConstant(written, 'X')
    expect(tool.readPublicKeyConstant(again)).toBe('X')
  })
})
