import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeUpdateUrl, type FetchLike } from '../electron/main/update/online'
import { UpdatePackageStore } from '../electron/main/update/package-store'
import { INSTALLER_ARGS, UpdateService, type UpdateServiceDeps } from '../electron/main/update/service'
import { UPDATE_PRODUCT, type UpdateDownloadProgress } from '../shared/update/types'
// @ts-expect-error 发版脚本是 .mjs，没有类型
import * as tool from '../scripts/update-package.mjs'

const BASE = 'https://updates.example.com/yzapp/'

describe('UpdateService', () => {
  let tmp: string
  let keys: { publicKeyPem: string; privateKeyPem: string }
  let store: UpdatePackageStore
  let calls: string[]
  let progress: (UpdateDownloadProgress | null)[]
  let served: Map<string, () => Response>
  let moving: string | null

  const packed = async (version: string) =>
    (await tool.packUpdate({
      installer: path.join(tmp, 'yzapp_setup.exe'),
      privateKeyPem: keys.privateKeyPem,
      version,
      notes: `v${version}`,
      releasedAt: '2026-11-20T08:00:00.000Z',
      outDir: path.join(tmp, 'out', version),
    })) as { packagePath: string; latestPath: string }

  /** 服务器上放 version 的 latest.json 和升级包 */
  const serve = async (version: string) => {
    const { packagePath, latestPath } = await packed(version)
    const latest = await fs.readFile(latestPath)
    const pkg = await fs.readFile(packagePath)
    served.set('latest.json', () => new Response(latest))
    served.set(path.basename(packagePath), () => new Response(pkg))
  }

  const fetchImpl: FetchLike = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop() ?? ''
    calls.push(`fetch ${name}`)
    const respond = served.get(name)
    if (!respond) return new Response('missing', { status: 404 })
    if (init?.signal?.aborted) throw new Error('aborted')
    return respond()
  }

  const createService = (patch: Partial<UpdateServiceDeps> = {}) =>
    new UpdateService({
      currentVersion: '1.1.0',
      installSupported: true,
      store,
      onlineUrl: BASE,
      downloadsDir: path.join(tmp, 'Updates', 'downloads'),
      fetch: fetchImpl,
      motionBlock: () => moving,
      launchInstaller: async (installerPath, args) => {
        calls.push(`launch ${path.basename(installerPath)} ${args.join(' ')}`)
      },
      stopRuntimes: () => calls.push('stop runtimes'),
      quit: () => calls.push('quit'),
      onProgress: (p) => progress.push(p),
      ...patch,
    })

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-update-svc-'))
    keys = tool.generateSigningKeys()
    await fs.writeFile(path.join(tmp, 'yzapp_setup.exe'), Buffer.alloc(200_000, 3))
    store = new UpdatePackageStore(path.join(tmp, 'Updates'), keys.publicKeyPem, UPDATE_PRODUCT)
    calls = []
    progress = []
    served = new Map()
    moving = null
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  describe('install', () => {
    it('launches the installer first, then stops the runtimes and quits', async () => {
      const service = createService()
      expect((await service.importPackage((await packed('1.2.0')).packagePath)).ok).toBe(true)

      expect(await service.install('1.2.0')).toEqual({ ok: true, data: null })
      expect(calls).toEqual([`launch yzapp_setup.exe ${INSTALLER_ARGS.join(' ')}`, 'stop runtimes', 'quit'])
      expect(await service.install('1.2.0')).toMatchObject({ ok: false, code: 'BUSY' })
    })

    it('rolls back to an older stored version the same way', async () => {
      const service = createService()
      await service.importPackage((await packed('1.0.0')).packagePath)
      const status = await service.status()
      expect(status.ok && status.data.packages).toMatchObject([{ version: '1.0.0', relation: 'older' }])
      expect((await service.install('1.0.0')).ok).toBe(true)
      expect(calls.at(-1)).toBe('quit')
    })

    it('does nothing while axes are moving', async () => {
      moving = '2 个轴运动中，全部停止后再升级'
      const service = createService()
      await service.importPackage((await packed('1.2.0')).packagePath)
      expect(await service.install('1.2.0')).toEqual({ ok: false, code: 'AXIS_MOVING', message: moving })
      expect(calls).toEqual([])
    })

    it('refuses unsupported builds, the current version and unknown versions', async () => {
      expect(await createService({ installSupported: false }).install('1.2.0')).toMatchObject({
        ok: false,
        code: 'UNSUPPORTED',
      })
      expect(await createService().install('1.1.0')).toMatchObject({ ok: false, code: 'SAME_VERSION' })
      expect(await createService().install('9.9.9')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
      expect(calls).toEqual([])
    })

    it('does not touch the runtimes when the installer cannot start, and can retry', async () => {
      let attempts = 0
      const service = createService({
        launchInstaller: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('EACCES')
        },
      })
      await service.importPackage((await packed('1.2.0')).packagePath)

      expect(await service.install('1.2.0')).toMatchObject({ ok: false, code: 'LAUNCH_FAILED' })
      expect(calls).toEqual([])
      expect((await service.install('1.2.0')).ok).toBe(true)
      expect(calls).toEqual(['stop runtimes', 'quit'])
    })
  })

  describe('online', () => {
    it('normalizes the server address', () => {
      expect(normalizeUpdateUrl(' https://a.example.com/yz ')).toBe('https://a.example.com/yz/')
      expect(normalizeUpdateUrl('ftp://a.example.com/')).toBeNull()
      expect(normalizeUpdateUrl('')).toBeNull()
      expect(normalizeUpdateUrl(undefined)).toBeNull()
    })

    it('reports when there is no server', async () => {
      expect(await createService({ onlineUrl: null }).check()).toMatchObject({ ok: false, code: 'NO_SERVER' })
    })

    it('checks, downloads with progress and stores the new version', async () => {
      await serve('1.2.0')
      const service = createService()

      expect(await service.check()).toMatchObject({
        ok: true,
        data: { latest: { version: '1.2.0' }, relation: 'newer', stored: false },
      })
      const downloaded = await service.downloadLatest()

      expect(downloaded).toMatchObject({ ok: true, data: { version: '1.2.0', relation: 'newer' } })
      expect(progress[0]).toMatchObject({ version: '1.2.0', received: 0 })
      expect(progress.at(-2)).toMatchObject({ version: '1.2.0' })
      expect(progress.at(-1)).toBeNull()
      expect(await service.check()).toMatchObject({ ok: true, data: { stored: true } })
      // 下载的文件导入后删掉
      expect(await fs.readdir(path.join(tmp, 'Updates', 'downloads'))).toEqual([])
      // 已经有了就不再下载
      calls = []
      expect((await service.downloadLatest()).ok).toBe(true)
      expect(calls.filter((c) => c.endsWith('.yzupd'))).toEqual([])
    })

    it('does not download versions that are not newer', async () => {
      await serve('1.1.0')
      expect(await createService().downloadLatest()).toMatchObject({ ok: false, code: 'NOT_NEWER' })
    })

    it('throws away a download that does not match latest.json', async () => {
      await serve('1.2.0')
      served.set('yzapp_1.2.0.yzupd', () => new Response(Buffer.alloc(10)))
      expect(await createService().downloadLatest()).toMatchObject({ ok: false, code: 'BAD_DOWNLOAD' })
      expect(await fs.readdir(path.join(tmp, 'Updates', 'downloads'))).toEqual([])
    })

    it('can cancel a download', async () => {
      await serve('1.2.0')
      let abortSignal: AbortSignal | undefined
      const service = createService({
        fetch: async (url, init) => {
          if (url.includes('latest.json')) return fetchImpl(url, init)
          abortSignal = init?.signal
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(1000))
                abortSignal?.addEventListener('abort', () => controller.error(new Error('aborted')))
              },
            }),
          )
        },
        onProgress: (p) => {
          progress.push(p)
          if (p && p.received > 0) service.cancelDownload()
        },
      })

      expect(await service.downloadLatest()).toMatchObject({ ok: false, code: 'CANCELLED' })
      expect(progress.at(-1)).toBeNull()
      const status = await service.status()
      expect(status.ok && status.data.download).toBeNull()
    })

    it('reports a broken latest.json', async () => {
      served.set('latest.json', () => new Response('{"version":"x"}'))
      expect(await createService().check()).toMatchObject({ ok: false, code: 'BAD_LATEST' })
    })
  })

  it('status says whether packages can be used', async () => {
    const noKey = new UpdatePackageStore(path.join(tmp, 'U2'), '', UPDATE_PRODUCT)
    const status = await createService({ store: noKey, onlineUrl: null }).status()
    expect(status).toEqual({
      ok: true,
      data: {
        currentVersion: '1.1.0',
        installSupported: true,
        signingKeyConfigured: false,
        onlineUrl: null,
        packages: [],
        download: null,
      },
    })
  })
})
