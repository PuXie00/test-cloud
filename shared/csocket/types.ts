export type DevItem = {
  devId: number
  parentDevId?: number
  type: string
  DevConfigParam?: unknown
}

export type CppAckResult<T = unknown> = {
  success: boolean
  code?: string | number
  message?: string
  data?: T[]
}

export type CsocketParamHeardItem = {
  [field: string]: number
}

export type CppEnvelope = {
  version: number
  timestamp: number
  messageId: string
  projectId?: string
  /** 登录用户名（如 admin），不是显示名 */
  userName?: string
  OptCmd: string
  addr: string
  params: unknown[]
  paramHeard?: CsocketParamHeardItem[]
  result?: CppAckResult
  code?: number
}

export type CsocketResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export type CsocketSendOpts = {
  /** 默认 true：等待 ACK；仅 false 时立即返回 */
  waitAck?: boolean
  timeoutMs?: number
  projectId?: boolean // 是否需要项目id
  userName?: boolean // 是否需要用户名
  paramHeard?: CsocketParamHeardItem[]
}

export type CsocketSendOpts2 = {
  /** 默认 true：等待 ACK；仅 false 时立即返回 */
  waitAck?: boolean
  timeoutMs?: number
}

export type CsocketConnectionState = {
  state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  url?: string
  lastError?: string
  rttMs?: number
  connectedAt?: number
}

export type CsocketMessageEvent = CppEnvelope
export type CsocketParseErrorEvent = {
  type: 'parseError'
  raw: string
  error: string
}

export type CsocketConfigureContext = {
  projectId?: string
  /** 当前登录用户名（如 admin），写进每条报文的 userName */
  userName?: string
}

export type BuildEnvelopeInput = Omit<
  CppEnvelope,
  'version' | 'timestamp' | 'messageId' | 'result'
> &
  Partial<Pick<CppEnvelope, 'version' | 'timestamp' | 'messageId' | 'result'>>
