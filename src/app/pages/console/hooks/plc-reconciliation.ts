import type { WizardSetupState } from "@/app/project/setup-persist";
import { insertMotorsAtBusEnd } from "./motor-bus-order";
import {
  allocateSetupEntityIdsInProject,
  toSetupEntityIdSource,
} from "./setup-entity-id";
import { removeMotorCascade } from "./setup-operations";
import type { DiscoveredMotor } from "./plc-runtime-types";

export type ConfiguredMotorRef = {
  id: number;
  plcId: number;
  discoveryId?: string | null;
  nodeAddress?: string | null;
};

export type ConnectedMotorMatch = {
  motor: ConfiguredMotorRef;
  discovered: DiscoveredMotor;
};

export type MotorReconciliationResult = {
  connected: ConnectedMotorMatch[];
  missing: ConfiguredMotorRef[];
  discoveredOnly: DiscoveredMotor[];
};

const normalizeIdentity = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const matchByIdentity = (
  motor: ConfiguredMotorRef,
  discovered: DiscoveredMotor,
): boolean => {
  const discoveryId = normalizeIdentity(motor.discoveryId);
  const serialNumber = normalizeIdentity(discovered.serialNumber);
  if (discoveryId && serialNumber && discoveryId === serialNumber) return true;

  const nodeAddress = normalizeIdentity(motor.nodeAddress);
  const discoveredAddress = normalizeIdentity(discovered.nodeAddress);
  return Boolean(nodeAddress && discoveredAddress && nodeAddress === discoveredAddress);
};

export const reconcileMotors = (
  plcId: number,
  configured: readonly ConfiguredMotorRef[],
  discovered: readonly DiscoveredMotor[],
): MotorReconciliationResult => {
  const scopedConfigured = configured.filter((motor) => motor.plcId === plcId);
  const connected: ConnectedMotorMatch[] = [];
  const missing: ConfiguredMotorRef[] = [];
  const usedDiscoveredIds = new Set<string>();

  for (const motor of scopedConfigured) {
    const match = discovered.find(
      (device) => !usedDiscoveredIds.has(device.id) && matchByIdentity(motor, device),
    );
    if (match) {
      connected.push({ motor, discovered: match });
      usedDiscoveredIds.add(match.id);
    } else {
      missing.push(motor);
    }
  }

  const discoveredOnly = discovered.filter((device) => !usedDiscoveredIds.has(device.id));

  return { connected, missing, discoveredOnly };
};

export type ReconciliationPatch = {
  pairings?: ReadonlyArray<{ motorId: number; discoveredId: string }>;
  adoptDiscoveredIds?: readonly string[];
  removeMotorIds?: readonly number[];
};

export const applyReconciliation = (
  state: WizardSetupState,
  plcId: number,
  discovered: readonly DiscoveredMotor[],
  patch: ReconciliationPatch,
): WizardSetupState => {
  const discoveredById = new Map(discovered.map((device) => [device.id, device]));
  let next = state;

  if (patch.pairings?.length) {
    next = {
      ...next,
      motors: next.motors.map((motor) => {
        const pairing = patch.pairings?.find((item) => item.motorId === motor.id);
        if (!pairing || motor.plcId !== plcId) return motor;

        const device = discoveredById.get(pairing.discoveredId);
        if (!device) return motor;

        return {
          ...motor,
          discoveryId: device.serialNumber,
          nodeAddress: device.nodeAddress ?? motor.nodeAddress,
          productModel: device.productModel ?? motor.productModel,
        };
      }),
    };
  }

  if (patch.adoptDiscoveredIds?.length) {
    const adopted = patch.adoptDiscoveredIds
      .map((discoveredId) => discoveredById.get(discoveredId))
      .filter((device): device is DiscoveredMotor => device !== undefined);

    const ids = allocateSetupEntityIdsInProject(toSetupEntityIdSource(next), adopted.length);
    const adoptedMotors = adopted.map((device, index) => ({
      id: ids[index]!,
      productModel: device.productModel ?? "YZ_AXIS_HOIST_500KG",
      plcId,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: device.nodeAddress ?? null,
      discoveryId: device.serialNumber,
      selected: true,
      controlledObjectId: null,
      axisKey: null,
      params: {},
    }));

    let motors = next.motors;
    for (const motor of adoptedMotors) {
      motors = insertMotorsAtBusEnd(motors, plcId, motor.busNo, [motor]);
    }
    next = { ...next, motors };
  }

  if (patch.removeMotorIds?.length) {
    next = patch.removeMotorIds.reduce(
      (current, motorId) => removeMotorCascade(current, motorId),
      next,
    );
  }

  return next;
};
