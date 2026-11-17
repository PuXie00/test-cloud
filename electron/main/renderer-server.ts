import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

let server: http.Server | null = null
let origin: string | null = null
let starting: Promise<string> | null = null

const contentType = (filePath: string): string =>
  MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'

/** 只允许读 root 里面的文件，挡住 ../ */
const resolveFile = (root: string, rawUrl: string): string | null => {
  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = path.resolve(root, relative)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  return filePath
}

const handleRequest = (root: string, req: http.IncomingMessage, res: http.ServerResponse): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  const filePath = resolveFile(root, req.url ?? '/')
  if (!filePath) {
    res.writeHead(400)
    res.end()
    return
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = fs.createReadStream(filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })
}

const listen = (rootDir: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const root = path.resolve(rootDir)
    const next = http.createServer((req, res) => handleRequest(root, req, res))
    const fail = (err: Error) => {
      next.close()
      reject(err)
    }
    next.once('error', fail)
    next.listen(0, '127.0.0.1', () => {
      next.off('error', fail)
      next.on('error', (err) => console.error(`[renderer] ${err.message}`))
      const address = next.address()
      if (!address || typeof address === 'string') {
        next.close()
        reject(new Error('renderer server has no port'))
        return
      }
      server = next
      origin = `http://127.0.0.1:${address.port}/`
      console.info(`[renderer] ${origin}`)
      resolve(origin)
    })
  })

/** 把打包后的页面目录挂到 127.0.0.1 的空闲端口。重复调用返回同一个地址 */
export const startRendererServer = (rootDir: string): Promise<string> => {
  if (origin) return Promise.resolve(origin)
  if (!starting) {
    starting = listen(rootDir).finally(() => {
      starting = null
    })
  }
  return starting
}

export const stopRendererServer = (): void => {
  const current = server
  server = null
  origin = null
  if (!current) return
  current.closeAllConnections()
  current.close()
}
