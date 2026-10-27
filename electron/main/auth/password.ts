import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/** 密码只存加盐的 scrypt 哈希：scrypt$N$r$p$salt$key（base64） */
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const COST: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>> = { N: 16384, r: 8, p: 1 }

const derive = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keyLength, options, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, KEY_LENGTH, COST)
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltText, keyText] = parts
  const N = Number(n)
  const options = { N, r: Number(r), p: Number(p), maxmem: 256 * N * Number(r) }
  if (![options.N, options.r, options.p].every((value) => Number.isInteger(value) && value > 0)) {
    return false
  }
  const expected = Buffer.from(keyText, 'base64')
  if (expected.length === 0) return false
  try {
    const key = await derive(password, Buffer.from(saltText, 'base64'), expected.length, options)
    return timingSafeEqual(key, expected)
  } catch {
    return false
  }
}
