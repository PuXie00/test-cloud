import fs from 'node:fs/promises'
import path from 'node:path'

/** 用户数据的读写；服务只认这个接口，测试换成内存实现 */
export type AuthStorage = {
  /** 文件不存在返回 null；内容坏了也返回 null（坏文件先挪开备份） */
  load: () => Promise<unknown | null>
  save: (data: unknown) => Promise<void>
}

export const createFileAuthStorage = (filePath: string): AuthStorage => ({
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
      const backup = `${filePath}.corrupt-${Date.now()}`
      await fs.rename(filePath, backup)
      console.error(`[auth] 用户数据无法解析，已备份到 ${backup}，恢复为初始状态`)
      return null
    }
  },
  // 先写临时文件并落盘，再改名覆盖，断电时不会留下写了一半的文件
  save: async (data) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, filePath)
  },
})
