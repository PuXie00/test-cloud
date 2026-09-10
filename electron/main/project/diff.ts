import type { DiffEntry } from './types'

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

const pushChange = (
  out: DiffEntry[],
  path: string,
  type: DiffEntry['type'],
  before?: unknown,
  after?: unknown,
): void => {
  out.push({ path, type, before, after })
}

const walk = (left: unknown, right: unknown, basePath: string, out: DiffEntry[]): void => {
  if (valuesEqual(left, right)) return

  if (Array.isArray(left) && Array.isArray(right)) {
    const max = Math.max(left.length, right.length)
    for (let i = 0; i < max; i += 1) {
      const childPath = `${basePath}/${i}`
      if (i >= left.length) {
        pushChange(out, childPath, 'add', undefined, right[i])
      } else if (i >= right.length) {
        pushChange(out, childPath, 'remove', left[i], undefined)
      } else {
        walk(left[i], right[i], childPath, out)
      }
    }
    return
  }

  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      const childPath = `${basePath}/${key}`
      const hasL = Object.prototype.hasOwnProperty.call(left, key)
      const hasR = Object.prototype.hasOwnProperty.call(right, key)
      if (!hasL) {
        pushChange(out, childPath, 'add', undefined, right[key])
      } else if (!hasR) {
        pushChange(out, childPath, 'remove', left[key], undefined)
      } else {
        walk(left[key], right[key], childPath, out)
      }
    }
    return
  }

  // 类型不同或原始值不同
  if (left === undefined) {
    pushChange(out, basePath || '/', 'add', undefined, right)
  } else if (right === undefined) {
    pushChange(out, basePath || '/', 'remove', left, undefined)
  } else {
    pushChange(out, basePath || '/', 'change', left, right)
  }
}

/** JSON 路径级对比，路径使用 JSON Pointer 风格（如 `/setup/plcs/0/ip`） */
export const diffJson = (left: unknown, right: unknown): DiffEntry[] => {
  const out: DiffEntry[] = []
  walk(left, right, '', out)
  return out.map((entry) => ({
    ...entry,
    path: entry.path || '/',
  }))
}
