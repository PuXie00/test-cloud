import fs from 'node:fs'
import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron'
import { AI_RESTART_MAX_MS, AI_RESTART_MIN_MS } from '../../../shared/ai-bridge/protocol'
import type { AiChildMessage, AiMainMessage } from '../../../shared/ai-bridge/types'

/** 跑满这么久再退出，下次重启从最短退避开始 */
const HEALTHY_RUN_MS = 30000

const verbose = Boolean(process.env.VITE_DEV_SERVER_URL) || process.env.BUILD_MODE === 'debug'

/** 管理 ai-server utilityProcess：拉起、意外退出后指数退避重启、退出时关闭 */
export class AiServerProcess {
  private child: UtilityProcess | null = null
  private ready = false
  private stopping = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartDelayMs = AI_RESTART_MIN_MS
  private spawnedAt = 0

  constructor(
    private readonly entry: string,
    private readonly port: number,
    /** 子进程 spawn 后回调：全量同步状态、交渲染进程端口 */
    private readonly onSpawn: () => void,
  ) {}

  start(): void {
    if (this.child || this.stopping) return
    if (!fs.existsSync(this.entry)) {
      console.warn(`[ai-server] entry not found: ${this.entry}`)
      return
    }

    const child = utilityProcess.fork(this.entry, [`--port=${this.port}`], {
      serviceName: 'yz-ai-server',
      stdio: verbose ? 'inherit' : 'ignore',
    })
    this.child = child
    this.ready = false

    child.on('spawn', () => {
      if (this.child !== child) return
      this.ready = true
      this.spawnedAt = Date.now()
      console.info(`[ai-server] started pid=${child.pid}`)
      this.onSpawn()
    })
    child.on('message', (message: AiChildMessage) => {
      if (message?.type === 'listen-error') {
        console.warn(`[ai-server] ${message.code}: ${message.message}`)
      }
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      this.ready = false
      if (this.stopping) return
      console.warn(`[ai-server] exited code=${code}`)
      this.scheduleRestart()
    })
  }

  /** 未就绪时返回 false；spawn 回调里会全量补发 */
  post(message: AiMainMessage, transfer?: MessagePortMain[]): boolean {
    if (!this.child || !this.ready) return false
    this.child.postMessage(message, transfer)
    return true
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const child = this.child
    this.child = null
    this.ready = false
    child?.kill()
  }

  private scheduleRestart(): void {
    if (Date.now() - this.spawnedAt >= HEALTHY_RUN_MS) this.restartDelayMs = AI_RESTART_MIN_MS
    const delay = this.restartDelayMs
    this.restartDelayMs = Math.min(delay * 2, AI_RESTART_MAX_MS)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
    }, delay)
  }
}
