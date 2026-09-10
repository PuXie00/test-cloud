import type { KinematicsSolveResult } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const fail = (
  code: Extract<KinematicsSolveResult, { ok: false }>['code'],
  message: string,
): KinematicsSolveResult => ({ ok: false, code, message })

/** YXZ_call.json: `{ path, data }` — path is an existing output directory. */
export const buildKinematicsCallFile = (
  items: unknown[],
  outputDir: string,
): { path: string; data: unknown[] } => ({
  path: outputDir,
  data: items,
})

export const validateKinematicsResults = (
  items: unknown[],
  expectedCount: number,
): KinematicsSolveResult => {
  if (!Array.isArray(items) || items.length !== expectedCount) {
    return fail('INVALID_RESULT', 'result count does not match request')
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!isRecord(item)) return fail('INVALID_RESULT', `result ${i + 1} is not an object`)
    if (typeof item.error === 'string' && item.error.length > 0) {
      return fail('SOLVE_ERROR', item.error)
    }
    if (item.index !== i + 1) {
      return fail('INVALID_RESULT', `result index ${String(item.index)} !== ${i + 1}`)
    }
    if (!Array.isArray(item.HPY) || item.HPY.length < 3) {
      return fail('INVALID_RESULT', `result ${i + 1} missing HPY`)
    }
    if (!Array.isArray(item.Motor_H)) {
      return fail('INVALID_RESULT', `result ${i + 1} missing Motor_H`)
    }
  }
  return { ok: true, data: items }
}

/** Parse YXZ.json. Latest exe: `{ version, errPrintStr, data }`. Legacy: result array. */
export const parseKinematicsResultFile = (
  parsed: unknown,
  expectedCount: number,
): KinematicsSolveResult => {
  if (Array.isArray(parsed)) {
    return validateKinematicsResults(parsed, expectedCount)
  }
  if (!isRecord(parsed)) {
    return fail('INVALID_RESULT', 'result is not an object or array')
  }
  if (typeof parsed.errPrintStr === 'string' && parsed.errPrintStr.length > 0) {
    return fail('SOLVE_ERROR', parsed.errPrintStr)
  }
  if (!Array.isArray(parsed.data)) {
    return fail('INVALID_RESULT', 'result data is not an array')
  }
  return validateKinematicsResults(parsed.data, expectedCount)
}
