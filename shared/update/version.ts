/** 软件版本号：主.次.修订，可带 -预发布 后缀（1.2.0、1.3.0-beta.1）。比较规则同 semver，不看 + 后的构建信息 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export const isValidVersion = (version: string): boolean => VERSION_RE.test(version)

type ParsedVersion = { core: [number, number, number]; pre: string[] }

const parse = (version: string): ParsedVersion => {
  const match = VERSION_RE.exec(version)
  if (!match) throw new Error(`版本号格式不对：${version}`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  }
}

const comparePreIdentifier = (a: string, b: string): number => {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** a < b 返回 -1，相等 0，a > b 返回 1；格式不对抛错 */
export const compareVersions = (a: string, b: string): number => {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i])
  }
  // 带预发布后缀的比正式版小
  if (left.pre.length === 0 || right.pre.length === 0) {
    return left.pre.length === right.pre.length ? 0 : left.pre.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i += 1) {
    const diff = comparePreIdentifier(left.pre[i], right.pre[i])
    if (diff !== 0) return diff
  }
  return Math.sign(left.pre.length - right.pre.length)
}
