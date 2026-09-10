import type { MotorModelConfig } from '../../../../shared/config'
import {
  filterDefaultAttrs,
  filterVariableDisplayAttrs,
  filterVariableOperationAttrs,
  isRecord,
  readDeviceMeta,
} from './shared'

export const parseMotorDescription = (
  raw: unknown,
  fileBaseName: string,
): MotorModelConfig | null => {
  if (!isRecord(raw)) return null
  const attribute = raw.Attribute
  if (!isRecord(attribute)) return null

  const meta = readDeviceMeta(raw)
  if (!meta) return null

  const hardware = isRecord(raw.HardwareParameters) ? { ...raw.HardwareParameters } : {}

  return {
    id: meta.id,
    name: meta.name,
    configPath: `/motors/${fileBaseName}`,
    hardware,
    variableConfig: filterVariableDisplayAttrs(attribute.configurationAttributes),
    variableStateAttri: filterVariableDisplayAttrs(attribute.stateAttributes),
    configAttributes: filterDefaultAttrs(attribute.configurationAttributes),
    stateAttributes: filterDefaultAttrs(attribute.stateAttributes),
    variableOperation: filterVariableOperationAttrs(raw.Operation),
  }
}
