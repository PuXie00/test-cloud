import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { HaLocalIp, HaSettings } from '../../../shared/ha/types'
import type { HaSettingsStorage } from './service'

/** 热备设置存一个 JSON：先写临时文件并落盘，再改名覆盖 */
export const createFileHaSettingsStorage = (filePath: string): HaSettingsStorage => ({
  load: async () => {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  },
  save: async (settings: HaSettings) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(JSON.stringify(settings, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, filePath)
  },
})

/** 本机的 IPv4 地址（不含回环），给主备页选「本机 IP」 */
export const listLocalIpv4 = (
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): HaLocalIp[] => {
  const result: HaLocalIp[] = []
  for (const [iface, addresses] of Object.entries(interfaces)) {
    for (const item of addresses ?? []) {
      if (item.internal) continue
      if (item.family !== 'IPv4' && (item.family as unknown) !== 4) continue
      result.push({ address: item.address, iface })
    }
  }
  return result
}
