import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RENDERER_PORT, startRendererServer, stopRendererServer } from '../electron/main/renderer-server'

describe('renderer server', () => {
  let root = ''

  afterEach(async () => {
    await stopRendererServer()
  })

  it('每次启动都挂在同一个本机端口', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderer-server-'))
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>', 'utf8')

    const first = await startRendererServer(root)
    expect(first).toBe(`http://127.0.0.1:${RENDERER_PORT}/`)
    expect(await startRendererServer(root)).toBe(first)

    const body = await fetch(first).then((response) => response.text())
    expect(body).toContain('ok')

    await stopRendererServer()
    expect(await startRendererServer(root)).toBe(first)

    await fs.rm(root, { recursive: true, force: true })
  })
})
