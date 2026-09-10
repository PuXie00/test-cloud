import type { CppAckResult } from './types'

export const isCppAckResult = (result: unknown): result is CppAckResult =>
  typeof result === 'object' &&
  result !== null &&
  typeof (result as { success?: unknown }).success === 'boolean'

export const isCppAckOk = (result: unknown): result is CppAckResult =>
  isCppAckResult(result) && result.success === true

export const isCppAckFailed = (
  result: unknown,
): result is CppAckResult & { success: false } =>
  isCppAckResult(result) && result.success === false
