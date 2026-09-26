import { useCallback, useEffect, useRef } from "react";
import type { SceneObjectConfig } from "@/app/viz3d";
import { useBuildDebugOptional } from "@/app/pages/console/components/build-debug/build-debug-context";
import {
  mmDimensionsToM,
  mmMountToM,
  mmVec3ToM,
} from "@/app/project/length-units";
import {
  modelRotationAxesForControlType,
  normalizeObjectRotationDeg,
  objectRotationDegToRad,
} from "@/app/project/object-rotation";
import { getMotorIdForAxis } from "../hooks/binding-utils";
import { getMotorDisplayIndex } from "@/app/pages/console/hooks/motor-mid";
import { hoistAxesEqual } from "@/app/viz3d/hoist-axis-config";
import { useProjectStore } from "../hooks/use-project-store";
import { sceneKinematicsEqual, sceneKinematicsForObject } from "./scene-kinematics";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";

const sceneConfigsEqual = (a: SceneObjectConfig, b: SceneObjectConfig): boolean =>
  a.id === b.id &&
  a.name === b.name &&
  a.shape === b.shape &&
  a.dimensions.w === b.dimensions.w &&
  a.dimensions.h === b.dimensions.h &&
  a.dimensions.d === b.dimensions.d &&
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  a.position.z === b.position.z &&
  a.centerOffset.x === b.centerOffset.x &&
  a.centerOffset.y === b.centerOffset.y &&
  a.centerOffset.z === b.centerOffset.z &&
  a.rotation.x === b.rotation.x &&
  a.rotation.y === b.rotation.y &&
  a.rotation.z === b.rotation.z &&
  (a.rotationAxes?.join(",") ?? "") === (b.rotationAxes?.join(",") ?? "") &&
  a.color === b.color &&
  a.model?.id === b.model?.id &&
  a.showHoistPoints === b.showHoistPoints &&
  a.selectedMotorId === b.selectedMotorId &&
  (a.selectedMotorIds?.join(",") ?? "") === (b.selectedMotorIds?.join(",") ?? "") &&
  hoistAxesEqual(a.hoistAxes, b.hoistAxes) &&
  sceneKinematicsEqual(a.kinematics, b.kinematics);

export const Viz3DObjectSync = () => {
  const engine = useViz3DContext();
  const { objects, motors } = useProjectStore();
  const { activeNav } = useConsoleNav();
  const { treeFocus } = useSelection();
  const buildDebug = useBuildDebugOptional();
  const prevConfigsRef = useRef<Map<string, SceneObjectConfig>>(new Map());

  const showHoistPoints = activeNav === "devices";
  const selectedMotorId =
    buildDebug?.armed && buildDebug.primaryMotorId
      ? buildDebug.primaryMotorId
      : treeFocus?.kind === "motor"
        ? treeFocus.id
        : null;
  const selectedMotorIds =
    buildDebug?.armed && buildDebug.selectedMotorIds.size > 0
      ? [...buildDebug.selectedMotorIds]
      : selectedMotorId
        ? [selectedMotorId]
        : undefined;

  const syncObjects = useCallback(() => {
    const configs: SceneObjectConfig[] = objects.map((object) => {
      return {
      id: String(object.id),
      name: object.name,
      // viz3d PresetShape 不含 external；外模走 model，几何回退 cube
      shape: object.shapePreset === "external" ? "cube" : object.shapePreset,
      dimensions: mmDimensionsToM(object.dimensions),
      position: mmVec3ToM(object.position),
      centerOffset: mmVec3ToM(object.centerOffset),
      rotation: objectRotationDegToRad(
        normalizeObjectRotationDeg(object.rotation, object.controlType),
      ),
      rotationAxes: modelRotationAxesForControlType(object.controlType),
      color: object.color,
      model: object.modelId ? { id: object.modelId } : undefined,
      hoistAxes: object.axes.map((axis, index) => {
        const motorId = getMotorIdForAxis(object.id, axis.key, motors);
        return {
          key: axis.key,
          motorId: motorId == null ? null : String(motorId),
          mount: mmMountToM(axis.mount),
          index,
          motorDisplayIndex: motorId == null ? null : getMotorDisplayIndex(motors, motorId),
        };
      }),
      selectedMotorId: selectedMotorId == null ? null : String(selectedMotorId),
      selectedMotorIds: selectedMotorIds?.map(String),
      showHoistPoints,
      kinematics: sceneKinematicsForObject(object),
    };
    });

    const prev = prevConfigsRef.current;
    const nextIds = new Set(configs.map((config) => config.id));
    const structureChanged =
      configs.length !== prev.size ||
      configs.some((config) => !prev.has(config.id)) ||
      [...prev.keys()].some((id) => !nextIds.has(id));

    if (structureChanged) {
      engine.setObjects(configs);
    } else {
      for (const config of configs) {
        const prior = prev.get(config.id);
        if (!prior || !sceneConfigsEqual(prior, config)) {
          engine.updateObject(config.id, config);
        }
      }
    }

    prevConfigsRef.current = new Map(configs.map((config) => [config.id, config]));
  }, [engine, objects, motors, selectedMotorId, selectedMotorIds, showHoistPoints]);

  useEffect(() => {
    const handleReady = () => {
      prevConfigsRef.current = new Map();
      syncObjects();
    };

    /** Template may arrive after first sync (cube fallback) — force remount onto object root. */
    const handleModelLoaded = (payload: { ok: boolean; id: string }) => {
      if (!payload.ok) return;
      for (const [id, config] of prevConfigsRef.current) {
        if (config.model?.id === payload.id) {
          prevConfigsRef.current.delete(id);
        }
      }
      syncObjects();
    };

    syncObjects();
    engine.events.on("ready", handleReady);
    engine.events.on("modelLoaded", handleModelLoaded);
    return () => {
      engine.events.off("ready", handleReady);
      engine.events.off("modelLoaded", handleModelLoaded);
    };
  }, [engine, syncObjects]);

  return null;
};
