import http from 'node:http'
import type { AiStatusKind } from '../../shared/ai-bridge/types'
import type { AiBridgeStore, AiResource } from './store'
import {
  CONFIG_SECTIONS,
  STATUS_KINDS,
  buildConfigBody,
  buildStatusBody,
  buildViewBody,
  type ConfigQuery,
  type ConfigSection,
  type StatusQuery,
} from './views'

/** 超过这么多条就整体清空；同一 version 的不同过滤条件才会并存 */
const CACHE_LIMIT = 64

const startedAt = Date.now()

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const parseList = (raw: string | null): string[] | null => {
  if (raw === null) return null
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

const parseIdSet = (raw: string | null): Set<number> | undefined => {
  const parts = parseList(raw)
  if (!parts) return undefined
  return new Set(parts.map(Number).filter((id) => Number.isFinite(id)))
}

export const parseConfigQuery = (params: URLSearchParams): ConfigQuery => {
  const sections = parseList(params.get('sections'))
  return {
    sections: sections
      ? CONFIG_SECTIONS.filter((section): section is ConfigSection => sections.includes(section))
      : null,
    full: params.get('full') === '1' || params.get('full') === 'true',
  }
}

export const parseStatusQuery = (params: URLSearchParams): StatusQuery => {
  const kinds = parseList(params.get('kinds'))
  const ids: StatusQuery['ids'] = {}
  for (const kind of STATUS_KINDS) {
    const set = parseIdSet(params.get(kind))
    if (set) ids[kind] = set
  }
  return {
    kinds: kinds ? STATUS_KINDS.filter((kind): kind is AiStatusKind => kinds.includes(kind)) : null,
    ids,
  }
}

const configQueryKey = (query: ConfigQuery): string =>
  query.full ? 'full' : (query.sections ?? CONFIG_SECTIONS).join(',')

const statusQueryKey = (query: StatusQuery): string => {
  const parts = [(query.kinds ?? STATUS_KINDS).join(',')]
  for (const kind of STATUS_KINDS) {
    const set = query.ids[kind]
    if (set) parts.push(`${kind}=${[...set].sort((a, b) => a - b).join(',')}`)
  }
  return parts.join('&')
}

const matchesEtag = (header: string | undefined, etag: string): boolean => {
  if (!header) return false
  return header.split(',').some((part) => {
    const value = part.trim()
    return value === '*' || value === etag || value === `W/${etag}`
  })
}

const splitHost = (header: string): { name: string; port: string } | null => {
  if (header.startsWith('[')) {
    const end = header.indexOf(']')
    if (end < 0) return null
    const name = header.slice(1, end)
    const rest = header.slice(end + 1)
    if (rest === '') return { name, port: '' }
    if (!rest.startsWith(':')) return null
    return { name, port: rest.slice(1) }
  }
  const colon = header.lastIndexOf(':')
  if (colon < 0) return { name: header, port: '' }
  return { name: header.slice(0, colon), port: header.slice(colon + 1) }
}

const isPrivateIPv4 = (name: string): boolean => {
  const parts = name.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}

/** 回环或局域网私有地址，且端口必须是服务实际端口。公网域名仍拒绝，避免 DNS 重绑定。 */
export const isAllowedAiHost = (hostHeader: string, port: number): boolean => {
  const parsed = splitHost(hostHeader.trim().toLowerCase())
  if (!parsed || parsed.port !== String(port)) return false
  if (parsed.name === '127.0.0.1' || parsed.name === 'localhost' || parsed.name === '::1') return true
  return isPrivateIPv4(parsed.name)
}

/**
 * 只读 JSON 服务。请求只读子进程内存快照，同一 version + 过滤条件只序列化一次。
 * Host 必须是回环或局域网私有地址加实际端口。
 */
export const createAiHttpServer = (store: AiBridgeStore): http.Server => {
  const cache = new Map<string, Buffer>()
  let listenPort: number | null = null

  const cached = (resource: AiResource, queryKey: string, build: () => unknown) => {
    const etag = `"${resource[0]}${store.version(resource)}-${fnv1a(queryKey)}"`
    let body = cache.get(etag)
    if (!body) {
      if (cache.size >= CACHE_LIMIT) cache.clear()
      body = Buffer.from(JSON.stringify(build()), 'utf8')
      cache.set(etag, body)
    }
    return { etag, body }
  }

  const send = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: Buffer,
    extra: http.OutgoingHttpHeaders = {},
  ): void => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      ...extra,
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  const fail = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    code: string,
    message: string,
    extra?: http.OutgoingHttpHeaders,
  ): void => {
    send(req, res, status, Buffer.from(JSON.stringify({ ok: false, code, message }), 'utf8'), extra)
  }

  const server = http.createServer((req, res) => {
    if (listenPort === null) {
      const address = server.address()
      if (address && typeof address === 'object') listenPort = address.port
    }
    const host = req.headers.host
    if (listenPort === null || !host || !isAllowedAiHost(host, listenPort)) {
      fail(req, res, 403, 'FORBIDDEN_HOST', 'Host must be loopback or a private LAN address with this port')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(req, res, 405, 'METHOD_NOT_ALLOWED', 'read-only API: use GET', { Allow: 'GET, HEAD' })
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    let result: { etag: string; body: Buffer }
    switch (url.pathname) {
      case '/api/health':
        send(
          req,
          res,
          200,
          Buffer.from(
            JSON.stringify({
              ok: true,
              pid: process.pid,
              uptimeMs: Date.now() - startedAt,
              rendererConnected: store.rendererConnected,
              versions: {
                view: store.version('view'),
                config: store.version('config'),
                status: store.version('status'),
              },
            }),
            'utf8',
          ),
        )
        return
      case '/api/view':
        console.log('view');
        result = cached('view', '', () => buildViewBody(store))
        break
      case '/api/config': {
        console.log('config');
        
        const query = parseConfigQuery(url.searchParams)
        result = cached('config', configQueryKey(query), () => buildConfigBody(store, query))
        break
      }
      case '/api/status': {
        console.log('status');
        const query = parseStatusQuery(url.searchParams)
        result = cached('status', statusQueryKey(query), () => buildStatusBody(store, query))
        break
      }
      default:
        fail(req, res, 404, 'NOT_FOUND', `unknown path ${url.pathname}`)
        return
    }

    if (matchesEtag(req.headers['if-none-match'], result.etag)) {
      res.writeHead(304, { ETag: result.etag, 'Cache-Control': 'no-cache' })
      res.end()
      return
    }
    send(req, res, 200, result.body, { ETag: result.etag })
  })

  return server
}
