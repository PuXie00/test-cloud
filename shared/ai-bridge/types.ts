import type { PlcMasterStatus } from '../csocket/plc-master-status'
import type { ModelInfo } from '../csocket/model-info'
import type { AxisInfo } from '../csocket/axis-info'
import type { CsocketConnectionState } from '../csocket/types'
import type { ProjectDocumentLike } from '../project/types'

// ── 渲染进程 → 子进程（经 preload 持有的 MessagePort 直连，不经 main） ──

export type AiPage = 'login' | 'project-center' | 'console' | 'rule-editor' | 'other'

export type AiProjectRef = {
  id: string
  name: string
  /** 磁盘目录名 */
  folderName: string
  /** 内存文档相对磁盘有未保存修改 */
  dirty: boolean
}

export type AiPageView = {
  page: AiPage
  /** HashRouter 路径，如 /console */
  path: string
  /** 规则编辑页的规则 id */
  ruleId: string | null
  project: AiProjectRef | null
}

export type AiNamedRef = { id: number; name: string }

export type AiTreeFocus = {
  kind: 'controlled-object' | 'master' | 'motor'
  id: number
  name: string
}

export type AiConsoleView = {
  mode: 'show' | 'rehearsal'
  nav: 'control' | 'devices' | 'sequences'
  /** 当前导航下右侧面板的 Tab；面板隐藏时为 null */
  tab: string | null
  selection: {
    /** 选中的受控物体（C++ model） */
    objects: AiNamedRef[]
    primaryObjectId: number | null
    motors: AiNamedRef[]
    /** 工程结构树聚焦项 */
    treeFocus: AiTreeFocus | null
    /** 动作页时间轴编辑器选中的序列 */
    sequence: AiNamedRef | null
  }
}

/** 显示名索引（电机/PLC 显示名不入库，由渲染进程派生）；JSON 键为实体 id */
export type AiEntityNames = {
  plcs: Record<string, string>
  motors: Record<string, string>
  objects: Record<string, string>
  sequences: Record<string, string>
}

export type AiConfigPayload = {
  revision: number
  dirty: boolean
  document: ProjectDocumentLike
  names: AiEntityNames
}

export type AiRendererMessage =
  | { type: 'page'; data: AiPageView }
  | { type: 'console'; data: AiConsoleView | null }
  | { type: 'config'; data: AiConfigPayload | null }

// ── main → 子进程：设备状态（合并后的增量） ──

export type AiActionLive = {
  actionId: number
  /** 1 过渡（回迹中），3 运行中 */
  state: number
  loopCount: number
  /** 0 为无限循环 */
  loopCountSet: number
  /** 轨迹运行的当前帧 */
  runTime: number
}

export type AiStatusKind = 'plcs' | 'objects' | 'motors' | 'actions'

export type AiConnectionState = CsocketConnectionState['state']

export type AiStatusDelta = {
  /** 先清空全部再应用（子进程重启后的全量同步） */
  reset?: boolean
  connection?: AiConnectionState
  clear?: AiStatusKind[]
  upsert?: {
    /** PLC 每次都是全量快照，替换 */
    plcs?: PlcMasterStatus[]
    objects?: ModelInfo[]
    motors?: AxisInfo[]
    actions?: AiActionLive[]
  }
  remove?: { actions?: number[] }
}

export type AiMainMessage =
  /** 随消息附带 ports[0]：渲染进程直连口 */
  | { type: 'renderer-port' }
  | { type: 'status'; delta: AiStatusDelta }

export type AiChildMessage =
  | { type: 'listening'; host: string; port: number }
  | { type: 'listen-error'; code: string; message: string }
