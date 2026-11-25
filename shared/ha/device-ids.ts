/**
 * 从指令报文里找出涉及的设备 id 和动作 id（params、paramHeard 里任何一层的 deviceId / actionId）。
 * 工程里 PLC、电机、物体的 id 全局互斥，所以电机和物体可以放在一起比。
 */

const MAX_VISITS = 50_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const collectIds = (roots: unknown[], key: string): number[] => {
  const found = new Set<number>()
  const stack: { value: unknown; depth: number }[] = roots.map((value) => ({ value, depth: 0 }))
  let visits = 0
  while (stack.length > 0 && visits < MAX_VISITS) {
    const { value, depth } = stack.pop()!
    visits += 1
    if (Array.isArray(value)) {
      if (depth > 6) continue
      for (const item of value) {
        if (typeof item === 'object' && item !== null) stack.push({ value: item, depth: depth + 1 })
      }
      continue
    }
    if (!isRecord(value) || depth > 6) continue
    for (const [field, item] of Object.entries(value)) {
      if (field === key) {
        if (typeof item === 'number' && Number.isInteger(item)) found.add(item)
        else if (Array.isArray(item)) {
          for (const id of item) if (typeof id === 'number' && Number.isInteger(id)) found.add(id)
        }
        continue
      }
      if (typeof item === 'object' && item !== null) stack.push({ value: item, depth: depth + 1 })
    }
  }
  return [...found].sort((a, b) => a - b)
}

export const commandDeviceIds = (params: unknown[], paramHeard?: unknown[]): number[] =>
  collectIds([params, paramHeard ?? []], 'deviceId')

export const commandActionIds = (params: unknown[], paramHeard?: unknown[]): number[] =>
  collectIds([params, paramHeard ?? []], 'actionId')
