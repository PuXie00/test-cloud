import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useProject, type ProjectUpdateResult } from "@/app/project/use-project";
import { applyObjectDeletion } from "@/app/project/project-object-deletion";
import { hydrateSetupFromDocument } from "@/app/project/setup-hydrate";
import {
  persistSetupFromWizard,
  type WizardSetupState,
} from "@/app/project/setup-persist";
import {
  controlTypeHasNoDriveAxes,
  defaultMotionParamsForControlType,
  ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE,
  nextDriveAxisKey,
  resolveSwingYawModelParams,
} from "@/app/project/configuration-rules";
import type { ControlType } from "@/app/project/configuration-types";
import {
  CONTROL_TYPE_DEFINITION_BY_ID,
  defaultShapeDimensions,
  SHAPE_DEFINITIONS,
  toEngineDimensions,
} from "../components/right-sidebar/config-wizard/config-descriptors";
import { buildAxesForControlType } from "../components/right-sidebar/config-wizard/axis-utils";
import {
  createNextAxisMount,
  createRelativeAxisMount,
} from "../components/right-sidebar/config-wizard/multi-point-axes/multi-point-axes-geometry";
import {
  DEFAULT_MODEL_RUN_DIRECTION,
  DEFAULT_PULLEY_DISTANCE,
} from "@/app/project/hoist-point-defaults";
import { DEFAULT_MAX_AXIS_VELOCITY } from "@/app/project/motion-speed";
import {
  clampMotionParamsToAxisMax,
  resolveVirtualAxisMaxVelocity,
  virtualAxisMaxFieldsFor,
} from "@/app/project/virtual-axis-max-velocity";
import {
  defaultMotorParamsFromModel,
  resolveMasterTypeIdByPlcModel,
  resolvePlcMasterTypeId,
  resolveProductModelByGourdNo,
} from "./motor-config";
import {
  applyBindMotorsFromAxis,
  bindMotorToAxis,
  canBindMotorToObject,
  countBoundAxesOnObject,
  getObjectBoundBusNo,
  getObjectBoundPlcId,
  getPlcLinkedObjectIds,
  objectHasUnboundAxes,
  unbindMotor,
} from "./binding-utils";
import type {
  AxisDefinition,
  BusNo,
  ControlledObject,
  Motor,
  MotorInput,
  MotorScanResult,
  Plc,
  PlcInput,
  PlcScanResult,
  ShapePresetId,
} from "../components/right-sidebar/config-wizard/config-wizard-types";

import {
  allocateSetupEntityIdsInProject,
  toSetupEntityIdSource,
} from "./setup-entity-id";
import {
  canPlaceMotorsOnBus,
  DEFAULT_BUS_NO,
  getPlcBusLimitsForPlc,
  isBusNo,
  remainingBusSlots,
} from "./motor-bus";
import { insertMotorsAtBusEnd, relocateMotorToBus } from "./motor-bus-order";
import {
  buildMotorParamPayload,
  motorDriveParamsChanged,
  onlyNumericDriveParamsChanged,
  runCsocket,
  syncAllMotors,
  syncPlcDevicesByDiff,
  syncMotorsByDiff,
} from "./motor-csocket-payload";
import { syncModelsByDiff, type ModelSyncState } from "./model-csocket-payload";
import {
  applyMultiPointAxesConfiguration as applyMultiPointAxesConfigurationToState,
  changeObjectControlType as changeObjectControlTypeInState,
  createPlcWithMotorSlots,
  insertMotorsRelative,
  removeMotorCascade,
  removeMotorsCascade,
  removeObjectAxisCascade,
  removePlcCascade,
  type InsertMotorsPosition,
  type MultiPointAxesConfigurationInput,
} from "./setup-operations";
import { applyControlTypeChange } from "./control-type-change";
import { applyReconciliation, type ReconciliationPatch } from "./plc-reconciliation";
import type { DiscoveredMotor, ScannedAxis } from "./plc-runtime-types";
import { cloneObjectsAt as cloneObjectsAtPure } from "./clone-objects";
import type { Vec3Mm } from "../3d/object-clipboard";

const resolveMasterTypeId = (masterTypeId: string) => resolvePlcMasterTypeId(masterTypeId);

const DEFAULT_CONTROL_TYPE: ControlType = "multiPointSwing";

const objectIdsAffectedByMotorChange = (
  previousMotors: readonly Motor[],
  nextMotors: readonly Motor[],
): Set<number> => {
  const previousById = new Map(previousMotors.map((motor) => [motor.id, motor]));
  const objectIds = new Set<number>();
  for (const motor of nextMotors) {
    const previous = previousById.get(motor.id);
    if (!previous) continue;
    if (previous.controlledObjectId !== motor.controlledObjectId) {
      if (previous.controlledObjectId != null) objectIds.add(previous.controlledObjectId);
      if (motor.controlledObjectId != null) objectIds.add(motor.controlledObjectId);
    }
    if (
      motor.controlledObjectId != null &&
      previous.params.maxAxisVelocity !== motor.params.maxAxisVelocity
    ) {
      objectIds.add(motor.controlledObjectId);
    }
  }
  return objectIds;
};

const clampObjectsToResolvedAxisMax = (
  objects: ControlledObject[],
  motors: readonly Motor[],
  objectIds: ReadonlySet<number>,
): ControlledObject[] => {
  if (objectIds.size === 0) return objects;
  return objects.map((item) => {
    if (!objectIds.has(item.id)) return item;
    const axes = CONTROL_TYPE_DEFINITION_BY_ID[item.controlType].motionAxes;
    const resolved = resolveVirtualAxisMaxVelocity(
      {
        id: item.id,
        enabledVirtualAxes: ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[item.controlType],
        pDefaultMaxVelocity: item.pDefaultMaxVelocity,
        yDefaultMaxVelocity: item.yDefaultMaxVelocity,
      },
      motors,
    );
    return {
      ...item,
      motionParams: clampMotionParamsToAxisMax(item.motionParams ?? {}, axes, resolved),
    };
  });
};

const withClampedObjectsForMotors = (
  prev: WizardSetupState,
  nextMotors: Motor[],
): WizardSetupState => {
  const objectIds = objectIdsAffectedByMotorChange(prev.motors, nextMotors);
  if (objectIds.size === 0) {
    return { ...prev, motors: nextMotors };
  }
  return {
    ...prev,
    motors: nextMotors,
    objects: clampObjectsToResolvedAxisMax(prev.objects, nextMotors, objectIds),
  };
};

const createControlledObject = (
  id: number,
  input: Pick<ControlledObject, "name" | "shapePreset" | "position"> &
    Partial<Pick<ControlledObject, "controlType" | "modelId" | "color">>,
): ControlledObject => {
  const controlType = input.controlType ?? DEFAULT_CONTROL_TYPE;
  const shapeDimensions = defaultShapeDimensions(input.shapePreset);
  return {
    id,
    name: input.name,
    controlType,
    shapePreset: input.shapePreset,
    shapeDimensions,
    dimensions: toEngineDimensions(input.shapePreset, shapeDimensions),
    position: input.position,
    centerOffset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    color: input.color ?? "#869398",
    motionParams: defaultMotionParamsForControlType(controlType),
    maxAxisVelocity: DEFAULT_MAX_AXIS_VELOCITY,
    ...virtualAxisMaxFieldsFor(ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[controlType]),
    pulleyDistance: DEFAULT_PULLEY_DISTANCE,
    modelRunDirection: DEFAULT_MODEL_RUN_DIRECTION,
    ...resolveSwingYawModelParams(controlType),
    axes: buildAxesForControlType(controlType),
    params: {},
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
  };
};

const defaultMotorParams = (productModel: string) => {
  const { axisType: _drop, ...params } = defaultMotorParamsFromModel(productModel);
  return params;
};

const canManageDriveAxes = (object: ControlledObject) =>
  !controlTypeHasNoDriveAxes(object.controlType);

const EMPTY_SETUP: WizardSetupState = { objects: [], plcs: [], motors: [] };

/** Keep ephemeral UI selection when re-baselining from authoritative document.setup. */
const withLocalMotorSelection = (
  baseline: WizardSetupState,
  local: WizardSetupState,
): WizardSetupState => {
  if (local.motors.length === 0) return baseline;
  const selectedById = new Map(local.motors.map((motor) => [motor.id, motor.selected]));
  let changed = false;
  const motors = baseline.motors.map((motor) => {
    const selected = selectedById.get(motor.id);
    if (selected === undefined || selected === motor.selected) return motor;
    changed = true;
    return { ...motor, selected };
  });
  return changed ? { ...baseline, motors } : baseline;
};

type SetupAction =
  | { type: "replace"; payload: WizardSetupState }
  | { type: "patch"; updater: (prev: WizardSetupState) => WizardSetupState };

const setupReducer = (state: WizardSetupState, action: SetupAction): WizardSetupState => {
  if (action.type === "replace") return action.payload;
  return action.updater(state);
};

const clearMotorBindingsForObject = (motors: Motor[], objectId: number): Motor[] =>
  motors.map((motor) =>
    motor.controlledObjectId === objectId
      ? { ...motor, controlledObjectId: null, axisKey: null }
      : motor,
  );

export type ProjectStoreContextValue = {
  objects: ControlledObject[];
  plcs: Plc[];
  motors: Motor[];
  addObjectFromShape: (
    shapeId: ShapePresetId,
    position?: Partial<ControlledObject["position"]>,
  ) => ControlledObject | null;
  addImportedObject: (modelId: string, name: string) => ControlledObject | null;
  cloneObjectsAt: (
    snapshots: readonly ControlledObject[],
    positions: readonly Vec3Mm[],
  ) => ControlledObject[];
  removeObject: (id: number) => void;
  removeObjects: (objectIds: readonly number[]) => ProjectUpdateResult;
  updateObject: (id: number, patch: Partial<ControlledObject>) => void;
  updateObjectsBatch: (updates: Array<{ id: number; patch: Partial<ControlledObject> }>) => void;
  changeObjectControlType: (
    objectIds: readonly number[],
    controlType: ControlType,
  ) => ProjectUpdateResult;
  addObjectAxis: (objectId: number) => void;
  insertObjectAxisRelative: (
    objectId: number,
    anchorAxisKey: string,
    position: "before" | "after",
  ) => boolean;
  addObjectAxesBatch: (objectId: number, count: number) => void;
  removeObjectAxis: (objectId: number, axisKey: string) => boolean;
  updateAxisMount: (
    objectId: number,
    axisKey: string,
    patch: Partial<{ x: number; z: number }>,
  ) => void;
  addPlc: (input: PlcInput) => Plc | null;
  updatePlc: (id: number, patch: Partial<Plc>) => void;
  applyPlcReconciliation: (
    plcId: number,
    discovered: readonly DiscoveredMotor[],
    patch: ReconciliationPatch,
  ) => void;
  removePlc: (id: number) => void;
  addPlcsFromScan: (results: PlcScanResult[]) => Promise<Plc[]>;
  /** 同从站口追加；count 默认 1，多个一次全量同步电机 */
  addMotor: (input: MotorInput, count?: number) => Motor[];
  insertMotorsRelative: (
    anchorMotorId: number,
    position: InsertMotorsPosition,
    count: number,
    productModel?: string,
    busNo?: BusNo,
    axisType?: Motor["axisType"],
  ) => Motor[];
  updateMotor: (id: number, patch: Partial<Motor>) => boolean;
  removeMotor: (id: number) => void;
  removeMotors: (ids: number[]) => void;
  addMotorsFromScan: (results: MotorScanResult[]) => Motor[];
  addMotorsFromScannedAxes: (plcId: number, axes: ScannedAxis[]) => Motor[];
  setMotorSelected: (id: number, selected: boolean) => void;
  setMotorsSelected: (ids: number[], selected: boolean) => void;
  removeSelectedMotors: () => void;
  applyMotorParamsToSelected: (params: Record<string, number | boolean>) => void;
  bindAxis: (objectId: number, axisKey: string, motorId: number | null) => boolean;
  bindMotorsFromAxis: (
    objectId: number,
    startAxisKey: string,
    motorIds: readonly number[],
  ) => boolean;
  applyMultiPointAxesConfiguration: (
    objectId: number,
    input: MultiPointAxesConfigurationInput,
  ) => { applied: boolean; reason?: string };
  getAvailableMotorsForAxis: (objectId: number, currentMotorId?: number | null) => Motor[];
  getBindingSummary: () => { bound: number; total: number };
  findObject: (id: number) => ControlledObject | undefined;
  findPlc: (id: number) => Plc | undefined;
  findMotor: (id: number) => Motor | undefined;
  getObjectsWithUnboundAxes: () => ControlledObject[];
  getObjectBoundPlcId: (objectId: number) => number | null;
  getPlcMotors: (plcId: number) => Motor[];
  getPlcUnassignedMotors: (plcId: number) => Motor[];
  getObjectMotors: (objectId: number) => Motor[];
  getObjectMotorsForPlc: (objectId: number, plcId: number) => Motor[];
  getPlcLinkedObjects: (plcId: number) => ControlledObject[];
  isMotorBound: (motorId: number) => boolean;
};

const ProjectStoreContext = createContext<ProjectStoreContextValue | null>(null);

const cloneMotorsSnapshot = (motors: readonly Motor[]): Motor[] =>
  motors.map((motor) => ({
    ...motor,
    params: { ...motor.params },
  }));

const cloneModelSyncState = (
  setup: Pick<WizardSetupState, "objects" | "motors">,
): ModelSyncState => ({
  objects: setup.objects.map((object) => ({
    ...object,
    axes: object.axes.map((axis) => ({
      ...axis,
      mount: { ...axis.mount },
    })),
    motionParams: Object.fromEntries(
      Object.entries(object.motionParams ?? {}).map(([key, value]) => [
        key,
        value ? { ...value } : value,
      ]),
    ),
  })),
  motors: cloneMotorsSnapshot(setup.motors),
});

export const ProjectStoreProvider = ({ children }: { children: ReactNode }) => {
  const {
    currentProject,
    documentRevision,
    isTrackedEditActive,
    runTrackedDocumentUpdate,
  } = useProject();
  const [setup, dispatchSetup] = useReducer(setupReducer, EMPTY_SETUP);
  const hydratedProjectIdRef = useRef<string | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const documentRevisionRef = useRef(documentRevision);
  documentRevisionRef.current = documentRevision;
  const wasTrackedEditActiveRef = useRef(false);
  const motorsAtTrackedEditStartRef = useRef<Motor[] | null>(null);
  const modelsAtTrackedEditStartRef = useRef<ModelSyncState | null>(null);

  const { objects, plcs, motors } = setup;

  const patchSetup = useCallback(
    (label: string, updater: (previous: WizardSetupState) => WizardSetupState) => {
      let previousLocal: WizardSetupState | undefined;
      let nextLocal: WizardSetupState | undefined;
      const result = runTrackedDocumentUpdate(
        label,
        (document) => {
          const baseline = withLocalMotorSelection(
            hydrateSetupFromDocument(document.setup),
            setupRef.current,
          );
          const next = updater(baseline);
          previousLocal = baseline;
          nextLocal = next;
          if (next === baseline) {
            return document;
          }
          return {
            ...document,
            setup: persistSetupFromWizard(next, document.setup),
          };
        },
        "setup",
      );
      if (!result.ok) {
        return result;
      }
      if (nextLocal !== undefined) {
        setupRef.current = nextLocal;
        dispatchSetup({ type: "replace", payload: nextLocal });
      }
      if (previousLocal && nextLocal) {
        syncModelsByDiff(
          { objects: previousLocal.objects, motors: previousLocal.motors },
          { objects: nextLocal.objects, motors: nextLocal.motors },
          isTrackedEditActive ? "tracked-preview" : "explicit",
        );
      }
      return result;
    },
    [isTrackedEditActive, runTrackedDocumentUpdate],
  );

  useEffect(() => {
    if (!currentProject) {
      if (hydratedProjectIdRef.current !== null) {
        hydratedProjectIdRef.current = null;
        setupRef.current = EMPTY_SETUP;
        dispatchSetup({ type: "replace", payload: EMPTY_SETUP });
      }
      return;
    }

    const document = currentProject.document;
    if (!document) return;

    if (
      hydratedProjectIdRef.current === currentProject.id &&
      documentRevision.origin === "setup"
    ) {
      return;
    }

    const prevPlcs = setupRef.current.plcs;
    const prevMotors = setupRef.current.motors;
    const prevModelState = {
      objects: setupRef.current.objects,
      motors: setupRef.current.motors,
    };
    const hydrated = hydrateSetupFromDocument(document.setup);
    setupRef.current = hydrated;
    dispatchSetup({ type: "replace", payload: hydrated });
    hydratedProjectIdRef.current = currentProject.id;

    if (documentRevision.origin === "history") {
      syncPlcDevicesByDiff(prevPlcs, hydrated.plcs);
      syncMotorsByDiff(prevMotors, hydrated.motors);
      syncModelsByDiff(
        prevModelState,
        { objects: hydrated.objects, motors: hydrated.motors },
        "history",
      );
    }
  }, [currentProject?.id, currentProject?.document, documentRevision]);

  /** tracked edit：begin 快照；commit（非 history）时 flush 驱动参与模型连续字段 */
  useEffect(() => {
    if (isTrackedEditActive && !wasTrackedEditActiveRef.current) {
      motorsAtTrackedEditStartRef.current = cloneMotorsSnapshot(setupRef.current.motors);
      modelsAtTrackedEditStartRef.current = cloneModelSyncState(setupRef.current);
    }
    if (!isTrackedEditActive && wasTrackedEditActiveRef.current) {
      const start = motorsAtTrackedEditStartRef.current;
      motorsAtTrackedEditStartRef.current = null;
      if (documentRevisionRef.current.origin !== "history" && start) {
        const startById = new Map(start.map((motor) => [motor.id, motor]));
        const changed = setupRef.current.motors.filter((motor) => {
          const before = startById.get(motor.id);
          return before ? motorDriveParamsChanged(before, motor) : false;
        });
        if (changed.length > 0) {
          runCsocket("configureAxisParamMotor", () =>
            window.csocketApi.configureAxisParamMotor(
              changed.map((motor) => buildMotorParamPayload(motor)),
            ),
          );
        }
      }
      const modelStart = modelsAtTrackedEditStartRef.current;
      modelsAtTrackedEditStartRef.current = null;
      if (modelStart && documentRevisionRef.current.origin !== "history") {
        syncModelsByDiff(
          modelStart,
          {
            objects: setupRef.current.objects,
            motors: setupRef.current.motors,
          },
          "tracked-commit",
        );
      }
    }
    wasTrackedEditActiveRef.current = isTrackedEditActive;
  }, [isTrackedEditActive]);

  const addObjectFromShape = useCallback(
    (shapeId: ShapePresetId, position?: Partial<ControlledObject["position"]>) => {
      const shapeLabel = SHAPE_DEFINITIONS.find((shape) => shape.id === shapeId)?.label ?? shapeId;
      const count = setupRef.current.objects.filter((o) => o.shapePreset === shapeId).length + 1;
      const [id] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(setupRef.current), 1);
      const obj = createControlledObject(id!, {
        name: `${shapeLabel}-${String(count).padStart(2, "0")}`,
        shapePreset: shapeId,
        position: {
          x: position?.x ?? 0,
          y: position?.y ?? 4000,
          z: position?.z ?? 0,
        },
      });
      const result = patchSetup("新增受控物体", (prev) => {
        const [freshId] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), 1);
        const nextObj = freshId === obj.id ? obj : { ...obj, id: freshId! };
        obj.id = nextObj.id;
        return { ...prev, objects: [...prev.objects, nextObj] };
      });
      return result.ok ? obj : null;
    },
    [patchSetup],
  );

  const addImportedObject = useCallback(
    (modelId: string, name: string) => {
      const [id] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(setupRef.current), 1);
      const obj = createControlledObject(id!, {
        name,
        shapePreset: "external",
        position: { x: 0, y: 4000, z: 0 },
        modelId,
      });
      const result = patchSetup("导入受控物体", (prev) => {
        const [freshId] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), 1);
        const nextObj = freshId === obj.id ? obj : { ...obj, id: freshId! };
        obj.id = nextObj.id;
        return { ...prev, objects: [...prev.objects, nextObj] };
      });
      return result.ok ? obj : null;
    },
    [patchSetup],
  );

  const cloneObjectsAt = useCallback(
    (snapshots: readonly ControlledObject[], positions: readonly Vec3Mm[]) => {
      let created: ControlledObject[] = [];
      const result = patchSetup("复制受控物体", (prev) => {
        const ids = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), snapshots.length);
        let index = 0;
        created = cloneObjectsAtPure(snapshots, positions, prev.objects, () => ids[index++]!);
        return { ...prev, objects: [...prev.objects, ...created] };
      });
      return result.ok ? created : [];
    },
    [patchSetup],
  );

  const removeObjects = useCallback(
    (objectIds: readonly number[]): ProjectUpdateResult => {
      const uniqueIds = [...new Set(objectIds)];
      if (uniqueIds.length === 0) return { ok: true as const, changed: false };
      const label =
        uniqueIds.length === 1 ? "删除受控物体" : `删除 ${uniqueIds.length} 个受控物体`;
      const before = cloneModelSyncState(setupRef.current);
      let after: ModelSyncState | undefined;
      const result = runTrackedDocumentUpdate(
        label,
        (document) => {
          const nextDocument = applyObjectDeletion(document, uniqueIds);
          const nextSetup = hydrateSetupFromDocument(nextDocument.setup);
          after = cloneModelSyncState(nextSetup);
          return nextDocument;
        },
        "project-command",
      );
      if (result.ok && result.changed && after) {
        syncModelsByDiff(before, after, "explicit");
      }
      return result;
    },
    [runTrackedDocumentUpdate],
  );

  const removeObject = useCallback(
    (id: number) => {
      removeObjects([id]);
    },
    [removeObjects],
  );

  const changeObjectControlType = useCallback(
    (objectIds: readonly number[], controlType: ControlType): ProjectUpdateResult => {
      const uniqueIds = [...new Set(objectIds)];
      if (uniqueIds.length === 0) return { ok: true as const, changed: false };
      const before = cloneModelSyncState(setupRef.current);
      let after: ModelSyncState | undefined;
      const label =
        uniqueIds.length === 1 ? "切换控制类型" : `切换 ${uniqueIds.length} 个物体控制类型`;
      const result = runTrackedDocumentUpdate(
        label,
        (document) => {
          const nextDocument = applyControlTypeChange(document, uniqueIds, controlType);
          after = cloneModelSyncState(hydrateSetupFromDocument(nextDocument.setup));
          return nextDocument;
        },
        "project-command",
      );
      if (result.ok && result.changed && after) {
        syncModelsByDiff(before, after, "explicit");
      }
      return result;
    },
    [runTrackedDocumentUpdate],
  );

  const updateObject = useCallback(
    (id: number, patch: Partial<ControlledObject>) => {
      patchSetup("修改受控物体", (prev) => {
        const current = prev.objects.find((object) => object.id === id);
        if (!current) return prev;

        if (patch.controlType !== undefined && patch.controlType !== current.controlType) {
          const { controlType, ...rest } = patch;
          let next = changeObjectControlTypeInState(prev, id, controlType);
          if (Object.keys(rest).length > 0) {
            next = {
              ...next,
              objects: next.objects.map((object) =>
                object.id === id ? { ...object, ...rest } : object,
              ),
            };
          }
          return next;
        }

        return {
          ...prev,
          objects: prev.objects.map((object) =>
            object.id === id ? { ...object, ...patch } : object,
          ),
        };
      });
    },
    [patchSetup],
  );

  const updateObjectsBatch = useCallback(
    (updates: Array<{ id: number; patch: Partial<ControlledObject> }>) => {
      if (updates.length === 0) return;

      patchSetup("批量修改受控物体", (prev) => {
        const patchById = new Map(updates.map(({ id, patch }) => [id, patch]));

        const objects = prev.objects.map((object) => {
          const patch = patchById.get(object.id);
          if (!patch) return object;

          if (patch.controlType !== undefined && patch.controlType !== object.controlType) {
            return (
              changeObjectControlTypeInState(prev, object.id, patch.controlType).objects.find(
                (item) => item.id === object.id,
              ) ?? object
            );
          }

          return { ...object, ...patch };
        });

        return { ...prev, objects };
      });
    },
    [patchSetup],
  );

  const addObjectAxis = useCallback(
    (objectId: number) => {
      patchSetup("修改吊点", (prev) => {
        const target = prev.objects.find((o) => o.id === objectId);
        if (!target || !canManageDriveAxes(target)) return prev;
        const objects = prev.objects.map((o) => {
          if (o.id !== objectId) return o;
          const axis: AxisDefinition = {
            key: nextDriveAxisKey(o.axes),
            custom: true,
            mount: createNextAxisMount(o.axes),
          };
          return { ...o, axes: [...o.axes, axis] };
        });
        return { ...prev, objects };
      });
    },
    [patchSetup],
  );

  const insertObjectAxisRelative = useCallback(
    (objectId: number, anchorAxisKey: string, position: "before" | "after"): boolean => {
      let inserted = false;
      const result = patchSetup("修改吊点", (prev) => {
        const target = prev.objects.find((o) => o.id === objectId);
        if (!target || !canManageDriveAxes(target)) return prev;
        const anchorIndex = target.axes.findIndex((axis) => axis.key === anchorAxisKey);
        if (anchorIndex < 0) return prev;

        inserted = true;
        const insertAt = position === "before" ? anchorIndex : anchorIndex + 1;
        const objects = prev.objects.map((o) => {
          if (o.id !== objectId) return o;
          const axis: AxisDefinition = {
            key: nextDriveAxisKey(o.axes),
            custom: true,
            mount: createRelativeAxisMount(o.axes, anchorIndex, position),
          };
          const nextAxes = [...o.axes];
          nextAxes.splice(insertAt, 0, axis);
          return { ...o, axes: nextAxes };
        });
        return { ...prev, objects };
      });
      return result.ok && inserted;
    },
    [patchSetup],
  );

  const addObjectAxesBatch = useCallback(
    (objectId: number, count: number) => {
      patchSetup("修改吊点", (prev) => {
        const target = prev.objects.find((o) => o.id === objectId);
        if (!target || !canManageDriveAxes(target)) return prev;
        const objects = prev.objects.map((o) => {
          if (o.id !== objectId) return o;
          const added: AxisDefinition[] = [];
          let growing = o.axes;
          for (let i = 0; i < count; i += 1) {
            const axis: AxisDefinition = {
              key: nextDriveAxisKey(growing),
              custom: true,
              mount: createNextAxisMount(growing),
            };
            added.push(axis);
            growing = [...growing, axis];
          }
          return { ...o, axes: [...o.axes, ...added] };
        });
        return { ...prev, objects };
      });
    },
    [patchSetup],
  );

  const removeObjectAxis = useCallback(
    (objectId: number, axisKey: string) => {
      let removed = false;
      const result = patchSetup("修改吊点", (prev) => {
        const target = prev.objects.find((object) => object.id === objectId);
        if (!target || !canManageDriveAxes(target)) return prev;

        const cascade = removeObjectAxisCascade(prev, objectId, axisKey);
        removed = cascade.removed;
        return cascade.state;
      });
      return result.ok && removed;
    },
    [patchSetup],
  );

  const updateAxisMount = useCallback(
    (objectId: number, axisKey: string, patch: Partial<{ x: number; z: number }>) => {
      patchSetup("修改吊点", (prev) => {
        const target = prev.objects.find((object) => object.id === objectId);
        if (!target) return prev;

        return {
          ...prev,
          objects: prev.objects.map((object) => {
            if (object.id !== objectId) return object;
            return {
              ...object,
              axes: object.axes.map((axis) =>
                axis.key === axisKey
                  ? { ...axis, mount: { ...axis.mount, ...patch } }
                  : axis,
              ),
            };
          }),
        };
      });
    },
    [patchSetup],
  );

  const addPlc = useCallback(
    (input: PlcInput) => {
      const masterTypeId = resolveMasterTypeId(input.masterTypeId);
      const [plcId] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(setupRef.current), 1);
      const plc: Plc = {
        id: plcId!,
        ip: input.ip,
        masterTypeId,
        status: "offline",
      };
      const result = patchSetup("新增 PLC", (prev) => {
        const [freshId] = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), 1);
        const nextPlc = freshId === plc.id ? plc : { ...plc, id: freshId! };
        plc.id = nextPlc.id;
        return createPlcWithMotorSlots(prev, { plc: nextPlc, motors: [] });
      });
      if (!result.ok || !result.changed) return null;
      void window.csocketApi.addDevicePlc([{ deviceId: plc.id, ip: plc.ip }]);
      return plc;
    },
    [patchSetup],
  );

  const updatePlc = useCallback(
    (id: number, patch: Partial<Plc>) => {
      patchSetup("修改 PLC", (prev) => {
        const current = prev.plcs.find((plc) => plc.id === id);
        if (!current) return prev;

        let nextPlc: Plc = { ...current, ...patch };
        if (patch.masterTypeId) {
          nextPlc = {
            ...nextPlc,
            masterTypeId: resolveMasterTypeId(patch.masterTypeId),
          };
        }

        return {
          ...prev,
          plcs: prev.plcs.map((plc) => (plc.id === id ? nextPlc : plc)),
        };
      });
    },
    [patchSetup],
  );

  const applyPlcReconciliation = useCallback(
    (plcId: number, discovered: readonly DiscoveredMotor[], patch: ReconciliationPatch) => {
      patchSetup("修改 PLC", (prev) => applyReconciliation(prev, plcId, discovered, patch));
    },
    [patchSetup],
  );

  const removePlc = useCallback(
    (id: number) => {
      const result = patchSetup("删除 PLC", (prev) => removePlcCascade(prev, id));
      if (result.ok && result.changed) {
        void window.csocketApi.deleteDevicePlc([{ deviceId: id }]);
      }
    },
    [patchSetup],
  );

  const addPlcsFromScan = useCallback(
    async (results: PlcScanResult[]) => {
      let added: Plc[] = [];
      let createdMotorIds: number[] = [];
      const result = patchSetup("新增 PLC", (prev) => {
        const plcIds = allocateSetupEntityIdsInProject(
          toSetupEntityIdSource(prev),
          results.length,
        );
        const plcsToAdd: Plc[] = results.map((r, i) => ({
          id: plcIds[i]!,
          ip: r.ip,
          masterTypeId: resolveMasterTypeIdByPlcModel(r.plcModel),
          status: "offline" as const,
        }));

        const motorInputs: { plcId: number; busNo: BusNo; productModel: string }[] = [];
        results.forEach((r, i) => {
          for (const axis of r.axis) {
            motorInputs.push({
              plcId: plcIds[i]!,
              busNo: isBusNo(axis.busNo) ? axis.busNo : DEFAULT_BUS_NO,
              productModel: resolveProductModelByGourdNo(axis.gourdNo),
            });
          }
        });
        const motorIds = allocateSetupEntityIdsInProject(
          toSetupEntityIdSource({
            plcs: [...prev.plcs, ...plcsToAdd],
            motors: prev.motors,
            objects: prev.objects,
          }),
          motorInputs.length,
        );
        const motorsToAdd: Motor[] = motorInputs.map((input, i) => ({
          id: motorIds[i]!,
          productModel: input.productModel,
          plcId: input.plcId,
          busNo: input.busNo,
          axisType: 0,
          nodeAddress: null,
          discoveryId: null,
          selected: true,
          controlledObjectId: null,
          axisKey: null,
          params: defaultMotorParams(input.productModel),
        }));

        added = plcsToAdd;
        createdMotorIds = motorsToAdd.map((motor) => motor.id);
        return {
          ...prev,
          plcs: [...prev.plcs, ...plcsToAdd],
          motors: [...prev.motors, ...motorsToAdd],
        };
      });
      if (!result.ok || !result.changed) return [];
      // 先添加 PLC，再同步电机（电机同步引用父 PLC 设备）
      try {
        await window.csocketApi.addDevicePlc(
          added.map((plc) => ({ deviceId: plc.id, ip: plc.ip })),
        );
      } catch (err) {
        console.error("[csocket] addDevicePlc", err);
      }
      const idSet = new Set(createdMotorIds);
      const createdMotors = setupRef.current.motors.filter((motor) => idSet.has(motor.id));
      if (createdMotors.length > 0) {
        syncAllMotors(setupRef.current.motors, createdMotors);
      }
      return added;
    },
    [patchSetup],
  );

  const addMotor = useCallback(
    (input: MotorInput, count = 1): Motor[] => {
      const busNo: BusNo = isBusNo(input.busNo) ? input.busNo : DEFAULT_BUS_NO;
      const axisType: Motor["axisType"] = input.axisType === 1 ? 1 : 0;
      const requested = Math.max(0, Math.floor(count));
      if (requested <= 0) return [];

      let createdIds: number[] = [];
      const result = patchSetup(requested === 1 ? "新增电机" : "批量新增电机", (prev) => {
        const limits = getPlcBusLimitsForPlc(input.plcId, prev.plcs);
        const allowed = remainingBusSlots(prev.motors, input.plcId, busNo, limits);
        const effectiveCount = Math.min(requested, allowed);
        if (effectiveCount <= 0) return prev;
        const ids = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), effectiveCount);
        const created: Motor[] = ids.map((id) => ({
          id: id!,
          productModel: input.productModel,
          plcId: input.plcId,
          busNo,
          axisType,
          nodeAddress: null,
          discoveryId: null,
          selected: true,
          controlledObjectId: null,
          axisKey: null,
          params: defaultMotorParams(input.productModel),
        }));
        createdIds = created.map((motor) => motor.id);
        return {
          ...prev,
          motors: insertMotorsAtBusEnd(prev.motors, input.plcId, busNo, created),
        };
      });
      if (!result.ok || !result.changed || createdIds.length === 0) return [];
      const idSet = new Set(createdIds);
      const created = setupRef.current.motors.filter((motor) => idSet.has(motor.id));
      if (created.length > 0) {
        syncAllMotors(setupRef.current.motors, created);
      }
      return created;
    },
    [patchSetup],
  );

  const insertMotorsRelativeAt = useCallback(
    (
      anchorMotorId: number,
      position: InsertMotorsPosition,
      count: number,
      productModel?: string,
      busNo?: BusNo,
      axisType?: Motor["axisType"],
    ) => {
      const anchor = setupRef.current.motors.find((motor) => motor.id === anchorMotorId);
      if (!anchor) return [];
      const targetBusNo = isBusNo(busNo) ? busNo : anchor.busNo;
      const targetAxisType = axisType === 1 ? 1 : 0;
      const limits = getPlcBusLimitsForPlc(anchor.plcId, setupRef.current.plcs);
      const allowed = remainingBusSlots(
        setupRef.current.motors,
        anchor.plcId,
        targetBusNo,
        limits,
      );
      const effectiveCount = Math.min(count, allowed);
      if (effectiveCount <= 0) return [];

      const result = insertMotorsRelative(setupRef.current, {
        anchorMotorId,
        position,
        count: effectiveCount,
        productModel,
        busNo: targetBusNo,
        axisType: targetAxisType,
        createParams: defaultMotorParams,
      });
      if (result.inserted.length === 0) return [];

      const insertedIds = new Set(result.inserted.map((motor) => motor.id));
      const patchResult = patchSetup("批量新增电机", (prev) => {
        if (prev.motors.some((motor) => insertedIds.has(motor.id))) {
          return prev;
        }
        const anchorIndex = prev.motors.findIndex((motor) => motor.id === anchorMotorId);
        if (anchorIndex < 0) return prev;
        const anchorMotor = prev.motors[anchorIndex]!;
        const motors =
          targetBusNo === anchorMotor.busNo
            ? (() => {
                const insertAt = position === "before" ? anchorIndex : anchorIndex + 1;
                return [
                  ...prev.motors.slice(0, insertAt),
                  ...result.inserted,
                  ...prev.motors.slice(insertAt),
                ];
              })()
            : insertMotorsAtBusEnd(prev.motors, anchorMotor.plcId, targetBusNo, result.inserted);
        return { ...prev, motors };
      });
      if (!patchResult.ok || !patchResult.changed) return [];
      const created = setupRef.current.motors.filter((motor) => insertedIds.has(motor.id));
      if (created.length > 0) {
        syncAllMotors(setupRef.current.motors, created);
      }
      return created;
    },
    [patchSetup],
  );

  const updateMotor = useCallback(
    (id: number, patch: Partial<Motor>): boolean => {
      const current = setupRef.current.motors.find((motor) => motor.id === id);
      if (!current) return false;
      const busNoChanging =
        patch.busNo !== undefined && isBusNo(patch.busNo) && patch.busNo !== current.busNo;
      if (busNoChanging) {
        const limits = getPlcBusLimitsForPlc(current.plcId, setupRef.current.plcs);
        if (
          !canPlaceMotorsOnBus(setupRef.current.motors, current.plcId, patch.busNo!, limits, {
            excludeMotorId: id,
          })
        ) {
          return false;
        }
      }
      const result = patchSetup("修改电机", (prev) => {
        const nextMotors = busNoChanging
          ? relocateMotorToBus(prev.motors, id, patch.busNo!).map((motor) =>
              motor.id === id ? { ...motor, ...patch, busNo: patch.busNo! } : motor,
            )
          : prev.motors.map((motor) => (motor.id === id ? { ...motor, ...patch } : motor));
        return withClampedObjectsForMotors(prev, nextMotors);
      });
      if (!result.ok || !result.changed) return result.ok;
      const next = setupRef.current.motors.find((motor) => motor.id === id);
      if (!next) return true;
      if (busNoChanging || next.axisType !== current.axisType) {
        syncAllMotors(setupRef.current.motors);
      } else if (motorDriveParamsChanged(current, next)) {
        if (isTrackedEditActive && onlyNumericDriveParamsChanged(current, next)) {
          return true;
        }
        runCsocket("configureAxisParamMotor", () =>
          window.csocketApi.configureAxisParamMotor([buildMotorParamPayload(next)]),
        );
      }
      return true;
    },
    [isTrackedEditActive, patchSetup],
  );

  const removeMotor = useCallback(
    (id: number) => {
      const prevMotors = setupRef.current.motors;
      const target = prevMotors.find((motor) => motor.id === id);
      const result = patchSetup("删除电机", (prev) => removeMotorCascade(prev, id));
      if (!result.ok || !result.changed || !target) return;
      syncAllMotors(setupRef.current.motors);
    },
    [patchSetup],
  );

  const removeMotors = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const prevMotors = setupRef.current.motors;
      const targets = prevMotors.filter((motor) => idSet.has(motor.id));
      const result = patchSetup("删除电机", (prev) => removeMotorsCascade(prev, ids));
      if (!result.ok || !result.changed || targets.length === 0) return;
      syncAllMotors(setupRef.current.motors);
    },
    [patchSetup],
  );

  const addMotorsFromScan = useCallback(
    (results: MotorScanResult[]) => {
      let added: Motor[] = [];
      const patchResult = patchSetup("批量新增电机", (prev) => {
        let working = prev.motors;
        added = [];
        for (const r of results) {
          const busNo = DEFAULT_BUS_NO;
          const limits = getPlcBusLimitsForPlc(r.plcId, prev.plcs);
          if (!canPlaceMotorsOnBus(working, r.plcId, busNo, limits)) continue;
          const [motorId] = allocateSetupEntityIdsInProject(
            toSetupEntityIdSource({ plcs: prev.plcs, motors: working, objects: prev.objects }),
            1,
          );
          const motor: Motor = {
            id: motorId!,
            productModel: r.productModel,
            plcId: r.plcId,
            busNo,
            axisType: 0,
            nodeAddress: r.nodeAddress,
            selected: true,
            controlledObjectId: null,
            axisKey: null,
            params: defaultMotorParams(r.productModel),
          };
          working = insertMotorsAtBusEnd(working, r.plcId, busNo, [motor]);
          added.push(motor);
        }
        return { ...prev, motors: working };
      });
      if (!patchResult.ok) return [];
      if (added.length > 0) {
        syncAllMotors(setupRef.current.motors, added);
      }
      return added;
    },
    [patchSetup],
  );

  const addMotorsFromScannedAxes = useCallback(
    (plcId: number, axes: ScannedAxis[]) => {
      const clean = axes.filter((axis) => isBusNo(axis.busNo));
      if (clean.length === 0) return [];
      let createdIds: number[] = [];
      const result = patchSetup("批量新增电机", (prev) => {
        if (!prev.plcs.some((plc) => plc.id === plcId)) return prev;
        const ids = allocateSetupEntityIdsInProject(toSetupEntityIdSource(prev), clean.length);
        const created: Motor[] = clean.map((axis, i) => {
          const productModel = resolveProductModelByGourdNo(axis.gourdNo);
          return {
            id: ids[i]!,
            productModel,
            plcId,
            busNo: axis.busNo as BusNo,
            axisType: 0,
            nodeAddress: null,
            discoveryId: null,
            selected: true,
            controlledObjectId: null,
            axisKey: null,
            params: defaultMotorParams(productModel),
          };
        });
        createdIds = created.map((motor) => motor.id);
        let motors = prev.motors;
        for (const motor of created) {
          motors = insertMotorsAtBusEnd(motors, plcId, motor.busNo, [motor]);
        }
        return { ...prev, motors };
      });
      if (!result.ok || !result.changed || createdIds.length === 0) return [];
      const idSet = new Set(createdIds);
      const created = setupRef.current.motors.filter((motor) => idSet.has(motor.id));
      if (created.length > 0) syncAllMotors(setupRef.current.motors, created);
      return created;
    },
    [patchSetup],
  );

  const setMotorSelected = useCallback(
    (id: number, selected: boolean) => {
      patchSetup("修改电机", (prev) => ({
        ...prev,
        motors: prev.motors.map((m) => (m.id === id ? { ...m, selected } : m)),
      }));
    },
    [patchSetup],
  );

  const setMotorsSelected = useCallback(
    (ids: number[], selected: boolean) => {
      const idSet = new Set(ids);
      patchSetup("批量修改电机", (prev) => ({
        ...prev,
        motors: prev.motors.map((m) => (idSet.has(m.id) ? { ...m, selected } : m)),
      }));
    },
    [patchSetup],
  );

  const removeSelectedMotors = useCallback(() => {
    patchSetup("删除电机", (prev) => {
      const motorIds = prev.motors.filter((motor) => motor.selected).map((motor) => motor.id);
      return removeMotorsCascade(prev, motorIds);
    });
  }, [patchSetup]);

  const applyMotorParamsToSelected = useCallback(
    (params: Record<string, number | boolean>) => {
      patchSetup("批量修改电机", (prev) => {
        const nextMotors = prev.motors.map((m) =>
          m.selected ? { ...m, params: { ...m.params, ...params } } : m,
        );
        return withClampedObjectsForMotors(prev, nextMotors);
      });
    },
    [patchSetup],
  );

  const bindAxis = useCallback(
    (objectId: number, axisKey: string, motorId: number | null): boolean => {
      if (motorId && !canBindMotorToObject(objectId, motorId, objects, motors)) {
        return false;
      }

      const label = motorId ? "绑定吊点" : "解绑吊点";
      const result = patchSetup(label, (prev) => {
        const targetObject = prev.objects.find((item) => item.id === objectId);
        if (!targetObject) return prev;
        const nextMotors = prev.motors.map((m) => {
          if (motorId && m.id === motorId) {
            return bindMotorToAxis(m, objectId, axisKey, targetObject.controlType);
          }
          if (m.controlledObjectId === objectId && m.axisKey === axisKey && m.id !== motorId) {
            return unbindMotor(m);
          }
          return m;
        });

        return withClampedObjectsForMotors(prev, nextMotors);
      });
      return result.ok;
    },
    [patchSetup, motors, objects],
  );

  const bindMotorsFromAxis = useCallback(
    (objectId: number, startAxisKey: string, motorIds: readonly number[]): boolean => {
      const preview = applyBindMotorsFromAxis(
        setupRef.current.objects,
        setupRef.current.motors,
        objectId,
        startAxisKey,
        motorIds,
      );
      if (!preview.ok) return false;
      const result = patchSetup("批量绑定", (prev) => {
        const bindResult = applyBindMotorsFromAxis(
          prev.objects,
          prev.motors,
          objectId,
          startAxisKey,
          motorIds,
        );
        if (!bindResult.ok) return prev;
        return withClampedObjectsForMotors(prev, bindResult.motors);
      });
      return result.ok;
    },
    [patchSetup],
  );

  const applyMultiPointAxesConfiguration = useCallback(
    (
      objectId: number,
      input: MultiPointAxesConfigurationInput,
    ): { applied: boolean; reason?: string } => {
      const preview = applyMultiPointAxesConfigurationToState(
        setupRef.current,
        objectId,
        input,
      );
      if (!preview.applied) {
        return { applied: false, reason: preview.reason };
      }
      const result = patchSetup("应用吊点配置", (previous) => {
        const applied = applyMultiPointAxesConfigurationToState(previous, objectId, input);
        return withClampedObjectsForMotors(
          { ...applied.state, motors: previous.motors },
          applied.state.motors,
        );
      });
      if (!result.ok) {
        return { applied: false, reason: result.reason };
      }
      return { applied: true };
    },
    [patchSetup],
  );

  const getAvailableMotorsForAxis = useCallback(
    (objectId: number, currentMotorId?: number | null) => {
      const boundPlcId = getObjectBoundPlcId(objectId, objects, motors);
      const boundBusNo = getObjectBoundBusNo(objectId, motors);
      return motors.filter(
        (motor) =>
          motor.selected &&
          (motor.controlledObjectId == null || motor.id === currentMotorId) &&
          (boundPlcId == null || motor.plcId === boundPlcId) &&
          (boundBusNo === null || motor.busNo === boundBusNo),
      );
    },
    [motors, objects],
  );

  const getBindingSummary = useCallback(() => {
    const total = objects.reduce((n, o) => n + o.axes.length, 0);
    const bound = objects.reduce((n, o) => n + countBoundAxesOnObject(o, motors), 0);
    return { bound, total };
  }, [objects, motors]);

  const findObject = useCallback((id: number) => objects.find((o) => o.id === id), [objects]);
  const findPlc = useCallback((id: number) => plcs.find((p) => p.id === id), [plcs]);
  const findMotor = useCallback((id: number) => motors.find((m) => m.id === id), [motors]);
  const getObjectsWithUnboundAxes = useCallback(
    () => objects.filter((object) => objectHasUnboundAxes(object, motors)),
    [objects, motors],
  );
  const resolveObjectBoundPlcId = useCallback(
    (objectId: number) => getObjectBoundPlcId(objectId, objects, motors),
    [objects, motors],
  );
  const getPlcMotors = useCallback(
    (plcId: number) => motors.filter((motor) => motor.plcId === plcId),
    [motors],
  );
  const getPlcUnassignedMotors = useCallback(
    (plcId: number) =>
      motors.filter((motor) => motor.plcId === plcId && motor.controlledObjectId == null),
    [motors],
  );
  const getObjectMotors = useCallback(
    (objectId: number) => motors.filter((motor) => motor.controlledObjectId === objectId),
    [motors],
  );
  const getObjectMotorsForPlc = useCallback(
    (objectId: number, plcId: number) =>
      motors.filter(
        (motor) => motor.controlledObjectId === objectId && motor.plcId === plcId,
      ),
    [motors],
  );
  const getPlcLinkedObjects = useCallback(
    (plcId: number) => {
      const linkedIds = new Set(getPlcLinkedObjectIds(plcId, motors));
      return objects.filter((object) => linkedIds.has(object.id));
    },
    [objects, motors],
  );
  const isMotorBound = useCallback(
    (motorId: number) => {
      const motor = motors.find((m) => m.id === motorId);
      return motor?.controlledObjectId != null && motor.axisKey != null;
    },
    [motors],
  );

  const value = useMemo<ProjectStoreContextValue>(
    () => ({
      objects,
      plcs,
      motors,
      addObjectFromShape,
      addImportedObject,
      cloneObjectsAt,
      removeObject,
      removeObjects,
      updateObject,
      updateObjectsBatch,
      changeObjectControlType,
      addObjectAxis,
      insertObjectAxisRelative,
      addObjectAxesBatch,
      removeObjectAxis,
      updateAxisMount,
      addPlc,
      updatePlc,
      applyPlcReconciliation,
      removePlc,
      addPlcsFromScan,
      addMotor,
      insertMotorsRelative: insertMotorsRelativeAt,
      updateMotor,
      removeMotor,
      removeMotors,
      addMotorsFromScan,
      addMotorsFromScannedAxes,
      setMotorSelected,
      setMotorsSelected,
      removeSelectedMotors,
      applyMotorParamsToSelected,
      bindAxis,
      bindMotorsFromAxis,
      applyMultiPointAxesConfiguration,
      getAvailableMotorsForAxis,
      getBindingSummary,
      findObject,
      findPlc,
      findMotor,
      getObjectsWithUnboundAxes,
      getObjectBoundPlcId: resolveObjectBoundPlcId,
      getPlcMotors,
      getPlcUnassignedMotors,
      getObjectMotors,
      getObjectMotorsForPlc,
      getPlcLinkedObjects,
      isMotorBound,
    }),
    [
      objects,
      plcs,
      motors,
      addObjectFromShape,
      addImportedObject,
      cloneObjectsAt,
      removeObject,
      removeObjects,
      updateObject,
      updateObjectsBatch,
      changeObjectControlType,
      addObjectAxis,
      insertObjectAxisRelative,
      addObjectAxesBatch,
      removeObjectAxis,
      updateAxisMount,
      addPlc,
      updatePlc,
      applyPlcReconciliation,
      removePlc,
      addPlcsFromScan,
      addMotor,
      insertMotorsRelativeAt,
      updateMotor,
      removeMotor,
      removeMotors,
      addMotorsFromScan,
      addMotorsFromScannedAxes,
      setMotorSelected,
      setMotorsSelected,
      removeSelectedMotors,
      applyMotorParamsToSelected,
      bindAxis,
      bindMotorsFromAxis,
      applyMultiPointAxesConfiguration,
      getAvailableMotorsForAxis,
      getBindingSummary,
      findObject,
      findPlc,
      findMotor,
      getObjectsWithUnboundAxes,
      resolveObjectBoundPlcId,
      getPlcMotors,
      getPlcUnassignedMotors,
      getObjectMotors,
      getObjectMotorsForPlc,
      getPlcLinkedObjects,
      isMotorBound,
    ],
  );

  return <ProjectStoreContext.Provider value={value}>{children}</ProjectStoreContext.Provider>;
};

export const useProjectStore = () => {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) throw new Error("useProjectStore must be used inside ProjectStoreProvider");
  return ctx;
};
