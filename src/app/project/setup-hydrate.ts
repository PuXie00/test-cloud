import type { ControlledObject, Motor, Plc } from "@/app/pages/console/components/right-sidebar/config-wizard/config-wizard-types";
import { controlledObjectConfigToWizard } from "./setup-adapters";
import type { MotorConfig, PlcConfig, ProjectSetup } from "./project-document-types";

export const plcConfigToWizard = (config: PlcConfig): Plc => ({
  id: config.id,
  masterTypeId: config.masterTypeId,
  ip: config.ip,
  status: "offline",
});

export const motorConfigToWizard = (config: MotorConfig): Motor => ({
  id: config.id,
  productModel: config.productModel,
  plcId: config.plcId,
  busNo: config.busNo,
  axisType: config.axisType === 1 ? 1 : 0,
  nodeAddress: config.nodeAddress,
  discoveryId: config.discoveryId ?? null,
  selected: true,
  controlledObjectId: config.controlledObjectId,
  axisKey: config.axisKey,
  params: { ...config.params },
});

export const hydrateSetupFromDocument = (
  setup: ProjectSetup,
): { objects: ControlledObject[]; plcs: Plc[]; motors: Motor[] } => ({
  objects: setup.controlledObjects.map(controlledObjectConfigToWizard),
  plcs: setup.plcs.map(plcConfigToWizard),
  motors: setup.motors.map(motorConfigToWizard),
});
