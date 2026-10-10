/** 本地 AI 只读 HTTP 服务（utilityProcess）的常量 */

/** 可用环境变量 YZ_AI_HTTP_PORT 覆盖 */
export const AI_HTTP_DEFAULT_PORT = 17890

/** 只监听本机回环地址 */
export const AI_HTTP_HOST = '127.0.0.1'

/** main → renderer：把直连子进程的 MessagePort 交给 preload */
export const AI_BRIDGE_PORT_CHANNEL = 'ai-bridge:port'

/** main 合并设备状态变化后推给子进程的间隔 */
export const AI_STATUS_FLUSH_MS = 100

/** PLC 只上报正在执行的动作（约 50ms 一次）；超过这么久没上报视为已停（同 ACTION_RUN_STALE_MS） */
export const AI_ACTION_STALE_MS = 1000

/** 渲染进程界面状态的合并间隔 */
export const AI_VIEW_PUBLISH_MS = 50

/** 工程配置变化后的防抖时间 */
export const AI_CONFIG_PUBLISH_MS = 300

/** 子进程意外退出后的重启退避 */
export const AI_RESTART_MIN_MS = 1000
export const AI_RESTART_MAX_MS = 30000
