/**
 * 两台前端之间的热备消息：放在 HA|send 的 payload 里，C++ 原样转发、不解析。
 * 版本由前端管，放在 hello 里；两边不一致就只连着、不同步（方案 7.1）。
 */
import type { CsocketParamHeardItem } from '../csocket/types'
import { isSafeAssetFileName } from '../project/model-files'
import type { HaProjectInfo, HaRole, HaSyncScope } from './types'

/** 热备消息的版本；消息格式改了就加一 */
export const HA_MESSAGE_VERSION = 1

export type HaHelloMessage = {
  type: 'hello'
  v: number
  hostName: string
  role: HaRole
  project: HaProjectInfo | null
  /** 收到对方的 hello 后回的，对方不再回 */
  reply?: boolean
  /** 主动关闭热备前发：对方显示「已关闭热备」，不当成断线 */
  closing?: boolean
}

/** 原样转给对方的指令报文 */
export type HaForwardEnvelope = {
  OptCmd: string
  addr: string
  params: unknown[]
  paramHeard?: CsocketParamHeardItem[]
  /** 实际操作的人（登录名） */
  userName?: string
}

/** 指令同步：本机执行的写指令（方案 6.3） */
export type HaCmdMessage = {
  type: 'cmd'
  projectId: string
  envelope: HaForwardEnvelope
}

/** 大内容切块（前端自己切，每块不超过 1 MB）：接收方每收到一块回一个 chunk-ack */
export type HaChunkMessage = {
  type: 'chunk'
  transferId: string
  seq: number
  total: number
  /** gzip 后 base64 的一段 */
  data: string
}

export type HaChunkAckMessage = {
  type: 'chunk-ack'
  transferId: string
  seq: number
}

/** 备机的核对状态（方案 4.3）：核对中、待确认（问用户用哪边的）、已同步 */
export type HaPeerSyncState = 'checking' | 'confirm' | 'synced'

/**
 * 工程同步的消息，由界面收发（主进程只转发）：
 * - sync-hello：互报同步范围内容的摘要；主机带同步范围，备机带核对状态；
 * - pull：备机请主机发整份；full：整份内容（items 保留数组顺序）；
 * - change：日常改动（主机按先后应用，再发给所有备机，origin 是改的那台）；bounce 表示被退回及原因；
 * - save：主机保存后通知备机，备机发来是请主机保存；notice：给对方的提示。
 */
export type HaAppMessage =
  | {
      type: 'sync-hello'
      projectId: string
      digest: string
      state?: HaPeerSyncState
      scope?: HaSyncScope
      reply?: boolean
    }
  | { type: 'pull'; projectId: string }
  | { type: 'full'; projectId: string; scope: HaSyncScope; items: [string, unknown][] }
  | {
      type: 'change'
      projectId: string
      origin: string
      originName: string
      put: Record<string, unknown>
      del: string[]
      bounce?: string
    }
  | { type: 'save'; projectId: string; request?: boolean; view?: unknown }
  | { type: 'notice'; projectId: string; text: string }
  | { type: 'status'; projectId: string; holders: HaStatusHolder[] }

export type HaAppMessageType = HaAppMessage['type']

/**
 * 在用的设备（方案 6.6）：每台把本机在用的物体、电机和在运行的动作发给另一台，有变化就发完整的一份。
 * 主机发给某台备机时，把其它备机的也带上（备机只连主机）。
 */
export type HaStatusHolder = {
  name: string
  /** 物体或电机 id（工程里全局互斥） */
  deviceIds: number[]
  /** 在运行的动作（序列 id） */
  sequenceIds: number[]
}

const APP_MESSAGE_TYPES = new Set<string>(['sync-hello', 'pull', 'full', 'change', 'save', 'notice', 'status'])

/** 主进程不解析内容，只认出类型和工程 id，转给界面 */
export type HaRelayMessage = { type: 'app'; message: HaAppMessage }

/**
 * 模型、封面文件（方案 5.6）：主进程之间直接传，大的由传输层切块；data 是 base64。
 * model-file 按模型包传：assets 是 OBJ 的 .mtl、贴图，sha256 是整包的摘要（没有附件时就是主文件的）。
 */
export type HaFileMessage =
  | {
      type: 'model-file'
      projectId: string
      name: string
      sha256: string
      data: string
      assets?: { name: string; data: string }[]
    }
  | { type: 'model-delete'; projectId: string; name: string }
  /** 备机核对完发给主机：本机的模型清单；prefer 是同名不同内容时用哪边的 */
  | {
      type: 'model-manifest'
      projectId: string
      files: { name: string; sha256: string; size: number }[]
      prefer: 'primary' | 'standby'
    }
  | { type: 'model-request'; projectId: string; names: string[] }
  | { type: 'cover-file'; projectId: string; fileName: string; data: string }

const FILE_MESSAGE_TYPES = new Set<string>([
  'model-file',
  'model-delete',
  'model-manifest',
  'model-request',
  'cover-file',
])

const isFileMessage = (payload: Record<string, unknown>): boolean => {
  if (typeof payload.projectId !== 'string' || !payload.projectId) return false
  switch (payload.type) {
    case 'model-file':
      return (
        typeof payload.name === 'string' &&
        typeof payload.sha256 === 'string' &&
        typeof payload.data === 'string' &&
        (payload.assets === undefined ||
          (Array.isArray(payload.assets) &&
            payload.assets.every(
              (asset) =>
                isRecord(asset) &&
                typeof asset.name === 'string' &&
                isSafeAssetFileName(asset.name) &&
                typeof asset.data === 'string',
            )))
      )
    case 'model-delete':
      return typeof payload.name === 'string'
    case 'model-manifest':
      return (
        Array.isArray(payload.files) &&
        payload.files.every(
          (file) =>
            isRecord(file) &&
            typeof file.name === 'string' &&
            typeof file.sha256 === 'string' &&
            typeof file.size === 'number',
        ) &&
        (payload.prefer === 'primary' || payload.prefer === 'standby')
      )
    case 'model-request':
      return Array.isArray(payload.names) && payload.names.every((name) => typeof name === 'string')
    case 'cover-file':
      return typeof payload.fileName === 'string' && typeof payload.data === 'string'
    default:
      return false
  }
}

export type HaMessage =
  | HaHelloMessage
  | HaCmdMessage
  | HaChunkMessage
  | HaChunkAckMessage
  | HaRelayMessage
  | HaFileMessage

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isProjectInfo = (value: unknown): value is HaProjectInfo =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.length > 0 &&
  typeof value.name === 'string' &&
  typeof value.formatVersion === 'number'

const isForwardEnvelope = (value: unknown): value is HaForwardEnvelope =>
  isRecord(value) &&
  typeof value.OptCmd === 'string' &&
  value.OptCmd.length > 0 &&
  typeof value.addr === 'string' &&
  Array.isArray(value.params) &&
  (value.paramHeard === undefined || Array.isArray(value.paramHeard)) &&
  (value.userName === undefined || typeof value.userName === 'string')

/**
 * 校验收到的消息；认不出来的返回 null（丢掉）。
 * hello 只校验到能判断版本：版本不一致时其它字段可能也不一样，仍要拿到 v 和 hostName 给界面提示。
 */
export const parseHaMessage = (payload: unknown): HaMessage | null => {
  if (!isRecord(payload) || typeof payload.type !== 'string') return null
  if (APP_MESSAGE_TYPES.has(payload.type)) {
    if (typeof payload.projectId !== 'string' || !payload.projectId) return null
    return { type: 'app', message: payload as HaAppMessage }
  }
  if (FILE_MESSAGE_TYPES.has(payload.type)) {
    return isFileMessage(payload) ? (payload as HaFileMessage) : null
  }
  switch (payload.type) {
    case 'hello': {
      if (typeof payload.v !== 'number' || typeof payload.hostName !== 'string') return null
      const role: HaRole = payload.role === 'primary' ? 'primary' : 'standby'
      return {
        type: 'hello',
        v: payload.v,
        hostName: payload.hostName,
        role,
        project: isProjectInfo(payload.project) ? payload.project : null,
        ...(payload.reply === true ? { reply: true } : {}),
        ...(payload.closing === true ? { closing: true } : {}),
      }
    }
    case 'cmd':
      if (typeof payload.projectId !== 'string' || !isForwardEnvelope(payload.envelope)) return null
      return { type: 'cmd', projectId: payload.projectId, envelope: payload.envelope }
    case 'chunk':
      if (
        typeof payload.transferId !== 'string' ||
        !Number.isInteger(payload.seq) ||
        !Number.isInteger(payload.total) ||
        typeof payload.data !== 'string' ||
        (payload.total as number) < 1 ||
        (payload.seq as number) < 0 ||
        (payload.seq as number) >= (payload.total as number)
      ) {
        return null
      }
      return {
        type: 'chunk',
        transferId: payload.transferId,
        seq: payload.seq as number,
        total: payload.total as number,
        data: payload.data,
      }
    case 'chunk-ack':
      if (typeof payload.transferId !== 'string' || !Number.isInteger(payload.seq)) return null
      return { type: 'chunk-ack', transferId: payload.transferId, seq: payload.seq as number }
    default:
      return null
  }
}
