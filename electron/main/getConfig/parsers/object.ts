import type { ObjectModelConfig } from '../../../../shared/config'
import { filterDefaultAttrs, filterVariableDisplayAttrs, isRecord, readDeviceMeta } from './shared'

export const parseObjectDescription = (
  raw: unknown,
  fileBaseName: string,
): ObjectModelConfig | null => {
  if (!isRecord(raw)) return null
  const attribute = raw.Attribute
  if (!isRecord(attribute)) return null

  const meta = readDeviceMeta(raw)
  if (!meta) return null

  const hardware = isRecord(raw.HardwareParameters) ? { ...raw.HardwareParameters } : {}

  return {
    id: meta.id,
    name: meta.name,
    configPath: `/objects/${fileBaseName}`,
    hardware,
    variableConfig: filterVariableDisplayAttrs(attribute.configurationAttributes),
    variableStateAttri: filterVariableDisplayAttrs(attribute.stateAttributes),
    configAttributes: filterDefaultAttrs(attribute.configurationAttributes),
    stateAttributes: filterDefaultAttrs(attribute.stateAttributes),
  }
}
