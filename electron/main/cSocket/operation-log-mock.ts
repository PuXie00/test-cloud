/**
 * Log|write mock：C++ 接口实现前由 api.ts 直接返回写入后的记录并推送。
 * 不写库，所以写入的记录只出现在控制页列表，查询里看不到。
 */
import type { CppAckResult } from '../../../shared/csocket/types'
import type { LogRecord, LogWriteParams } from '../../../shared/csocket/operation-log'

let writeSeq = 0

export const mockLogWrite = (params: LogWriteParams, user?: string): CppAckResult<LogRecord> => {
  const { timestamp, ...rest } = params
  const record: LogRecord = {
    id: `log-w-${(++writeSeq).toString().padStart(4, '0')}`,
    timestamp: timestamp ?? Date.now(),
    ...rest,
    ...(user ? { user } : {}),
  }
  return { success: true, data: [record] }
}
