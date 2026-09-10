import type {
  DisplayAttribute,
  DisplayOperation,
  OperationField,
  OperationKind,
  OperationPrecondition,
  OperationResponseField,
} from '../../../../shared/config'

const OPERATION_KINDS = new Set<OperationKind>(['button', 'formButton', 'holdButton'])

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keep display:true & type:variable attrs; */
export const filterVariableDisplayAttrs = (list: unknown): DisplayAttribute[] => {
  if (!Array.isArray(list)) return []
  const out: DisplayAttribute[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (item.display !== true) continue
    if (typeof item.id !== 'string' || typeof item.label !== 'string') continue
    if (typeof item.dataType !== 'string') continue
    if (item.type !== 'variable') continue
    out.push({...item,type:'variable' as const} as DisplayAttribute)
  }
  return out
}

export const filterDefaultAttrs = (list: unknown): DisplayAttribute[] => {
  if (!Array.isArray(list)) return []
  const out: DisplayAttribute[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (item.display !== true) continue
    if (typeof item.id !== 'string' || typeof item.label !== 'string') continue
    if (typeof item.dataType !== 'string') continue
    out.push({...item,type:item.type === 'variable' ? 'variable' as const : 'basic' as const} as DisplayAttribute)
  }
  return out
}

export const readDeviceMeta = (
  raw: Record<string, unknown>,
): { id: string; name: string } | null => {
  const device = isRecord(raw.device) ? raw.device : null
  const id =
    device && typeof device.id === 'string' && device.id.trim()
      ? device.id.trim()
      : null
  const name =
    device && typeof device.name === 'string' && device.name.trim()
      ? device.name.trim()
      : null
  if (!id || !name) return null
  return { id, name }
}

const parseOperationResponseFields = (list: unknown): OperationResponseField[] => {
  if (!Array.isArray(list)) return []
  const out: OperationResponseField[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string') continue
    const field: OperationResponseField = { id: item.id }
    if (typeof item.label === 'string') field.label = item.label
    if (typeof item.dataType === 'string') field.dataType = item.dataType
    if (typeof item.byteLength === 'number') field.byteLength = item.byteLength
    if (typeof item.unit === 'string') field.unit = item.unit
    if (typeof item.scale === 'number') field.scale = item.scale
    if (typeof item.min === 'number') field.min = item.min
    if (typeof item.max === 'number') field.max = item.max
    if (Array.isArray(item.values)) field.values = item.values as OperationResponseField['values']
    if (Array.isArray(item.items)) field.items = parseOperationResponseFields(item.items)
    out.push(field)
  }
  return out
}

const parseOperationParams = (list: unknown): OperationField[] => {
  if (!Array.isArray(list)) return []
  const out: OperationField[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string') continue
    if (typeof item.label !== 'string') continue
    if (typeof item.dataType !== 'string') continue
    if (typeof item.byteLength !== 'number') continue
    const field: OperationField = {
      id: item.id,
      label: item.label,
      dataType: item.dataType,
      byteLength: item.byteLength,
    }
    if (typeof item.unit === 'string') field.unit = item.unit
    if (typeof item.DefaultValue === 'number' || typeof item.DefaultValue === 'string') {
      field.DefaultValue = item.DefaultValue
    }
    if (typeof item.scale === 'number') field.scale = item.scale
    if (typeof item.min === 'number') field.min = item.min
    if (typeof item.max === 'number') field.max = item.max
    if (Array.isArray(item.values)) field.values = item.values as OperationField['values']
    if (Array.isArray(item.items)) field.items = parseOperationResponseFields(item.items)
    out.push(field)
  }
  return out
}

const parsePreconditions = (list: unknown): OperationPrecondition[] => {
  if (!Array.isArray(list)) return []
  const out: OperationPrecondition[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (typeof item.state !== 'string') continue
    const value = item.value
    if (
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    ) {
      continue
    }
    out.push({ state: item.state, value })
  }
  return out
}

/** Keep display:true Operation entries (button / formButton / holdButton). */
export const filterVariableOperationAttrs = (list: unknown): DisplayOperation[] => {
  if (!Array.isArray(list)) return []
  const out: DisplayOperation[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    if (item.display !== true) continue
    if (typeof item.id !== 'string' || typeof item.label !== 'string') continue
    if (typeof item.transport !== 'string') continue
    if (typeof item.type !== 'string' || !OPERATION_KINDS.has(item.type as OperationKind)) continue
    if (item.group !== 'variable') continue
    out.push({
      id: item.id,
      label: item.label,
      transport: item.transport,
      type: item.type as OperationKind,
      group: typeof item.group === 'string' ? item.group : undefined,
      addr: typeof item.addr === 'string' ? item.addr : undefined,
      param: parseOperationParams(item.param),
      response: parseOperationResponseFields(item.response),
      display: true,
      confirmationLevel:
        typeof item.confirmationLevel === 'string' ? item.confirmationLevel : undefined,
      preconditions: parsePreconditions(item.preconditions),
    })
  }
  return out
}
