import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { once } from 'node:events'
import {
  latestFileName,
  parseUpdateLatest,
  type UpdateLatest,
  type UpdateResult,
  type UpdateTarget,
} from '../../../shared/update/types'

/**
 * 在线更新：服务器目录（YZ_UPDATE_URL）下放 latest-<平台>-<架构>.json 和 .yzupd，每种平台 + 架构各一份。
 * latest 文件只是指路，下载完照样按签名完整校验升级包（见 package-store.ts）。
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

const ok = <T>(data: T): UpdateResult<T> => ({ ok: true, data })
const fail = <T>(code: string, message: string): UpdateResult<T> => ({ ok: false, code, message })
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** 只认 http(s)；末尾补 /，好让相对路径落在这个目录下 */
export const normalizeUpdateUrl = (raw: string | undefined): string | null => {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value.endsWith('/') ? value : `${value}/`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export const fetchLatest = async (
  baseUrl: string,
  fetchImpl: FetchLike,
  target: UpdateTarget,
): Promise<UpdateResult<UpdateLatest>> => {
  const fileName = latestFileName(target)
  const url = new URL(fileName, baseUrl)
  // 带个时间戳，别拿到中间缓存的旧 latest.json
  url.searchParams.set('t', String(Date.now()))
  let res: Response
  try {
    res = await fetchImpl(url.href)
  } catch (err) {
    return fail('NETWORK', `连不上更新服务器（${errorText(err)}）`)
  }
  if (res.status === 404) return fail('NO_RELEASE', `更新服务器上还没有本机这种平台的版本（${fileName}）`)
  if (!res.ok) return fail('NETWORK', `更新服务器返回 ${res.status}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return fail('BAD_LATEST', `更新服务器上的 ${fileName} 不是有效的 JSON`)
  }
  const latest = parseUpdateLatest(body)
  if (typeof latest === 'string') return fail('BAD_LATEST', `${fileName} 内容不对：${latest}`)
  if (latest.platform !== target.platform || latest.arch !== target.arch) {
    return fail('BAD_LATEST', `${fileName} 写的是 ${latest.platform}-${latest.arch} 的版本`)
  }
  return ok(latest)
}

/** 下载到 dest（先写 dest.part，大小和 sha512 对上才改名）；onProgress 收到已下载的字节数 */
export const downloadFile = async (params: {
  url: string
  dest: string
  size: number
  sha512: string
  fetchImpl: FetchLike
  signal: AbortSignal
  onProgress: (received: number) => void
}): Promise<UpdateResult<null>> => {
  const part = `${params.dest}.part`
  const cleanup = () => fs.rm(part, { force: true }).catch(() => undefined)
  let res: Response
  try {
    res = await params.fetchImpl(params.url, { signal: params.signal })
  } catch (err) {
    return params.signal.aborted
      ? fail('CANCELLED', '已取消下载')
      : fail('NETWORK', `下载失败（${errorText(err)}）`)
  }
  if (!res.ok || !res.body) return fail('NETWORK', `下载失败：服务器返回 ${res.status}`)

  const hash = createHash('sha512')
  let received = 0
  const out = createWriteStream(part)
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length
      if (received > params.size) throw new Error('下载的文件比 latest.json 写的大')
      hash.update(chunk)
      if (!out.write(chunk)) await once(out, 'drain')
      params.onProgress(received)
    }
    out.end()
    await once(out, 'finish')
  } catch (err) {
    out.destroy()
    await cleanup()
    return params.signal.aborted
      ? fail('CANCELLED', '已取消下载')
      : fail('NETWORK', `下载失败（${errorText(err)}）`)
  }
  if (received !== params.size || hash.digest('base64') !== params.sha512) {
    await cleanup()
    return fail('BAD_DOWNLOAD', '下载的升级包不完整，请重新下载')
  }
  await fs.rename(part, params.dest)
  return ok(null)
}
