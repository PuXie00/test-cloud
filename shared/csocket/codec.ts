import { randomUUID } from 'node:crypto'
import type { BuildEnvelopeInput, CppAckResult, CppEnvelope } from './types'
import { PROTOCOL_VERSION } from './protocol'

export { PROTOCOL_VERSION }

const toAckResult = (value: unknown): CppAckResult => {
  if (!value || typeof value !== 'object') {
    throw new Error('csocket: result must be object')
  }
  const r = value as Record<string, unknown>
  if (typeof r.success !== 'boolean') {
    throw new Error('csocket: result.success must be boolean')
  }
  return {
    success: r.success,
    code: r.code === undefined || r.code === null ? undefined : (r.code as string | number),
    message: r.message === undefined || r.message === null ? undefined : String(r.message),
    data: Array.isArray(r.data) ? r.data : undefined,
  }
}

export const buildEnvelope = (input: BuildEnvelopeInput): CppEnvelope => {
  const envelope: CppEnvelope = {
    version: input.version ?? PROTOCOL_VERSION,
    timestamp: input.timestamp ?? Date.now(),
    messageId: input.messageId ?? randomUUID(),
    projectId: input.projectId,
    user: input.user,
    OptCmd: input.OptCmd,
    addr: input.addr,
    params: input.params ?? [],
    result: input.result,
  }
  const paramHeard = input.paramHeard
  if (paramHeard && paramHeard.length > 0) {
    envelope.paramHeard = paramHeard
  }
  return envelope
}

export const parseEnvelope = (raw: string): CppEnvelope => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('csocket: invalid JSON')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('csocket: envelope must be object')
  }
  const o = data as Record<string, unknown>
  for (const key of ['version', 'timestamp', 'messageId', 'OptCmd'] as const) {
    if (o[key] === undefined || o[key] === null) {
      throw new Error(`csocket: missing field ${key}`)
    }
  }

  let params: unknown[] = []
  if (o.params !== undefined && o.params !== null) {
    if (!Array.isArray(o.params)) {
      throw new Error('csocket: params must be array')
    }
    params = o.params as unknown[]
  }

  return {
    version: Number(o.version),
    timestamp: Number(o.timestamp),
    messageId: String(o.messageId),
    projectId: o.projectId === undefined ? undefined : String(o.projectId),
    user: o.user === undefined ? undefined : String(o.user),
    OptCmd: String(o.OptCmd),
    addr: o.addr === undefined || o.addr === null ? '' : String(o.addr),
    params,
    result: o.result === undefined || o.result === null ? undefined : toAckResult(o.result),
    code: o.code === undefined || o.code === null ? undefined : Number(o.code),
  }
}
