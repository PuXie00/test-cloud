import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useControlledObjects } from "@/app/pages/console/hooks/use-controlled-objects";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { BuildDebugContext, type BuildDebugContextValue } from "./build-debug-context";
import { imbalancedTorqueMotorIds, telemetryFromSnapshot } from "./build-debug-logic";
import type { JogStep } from "./build-debug-types";

export { useBuildDebug, useBuildDebugOptional } from "./build-debug-context";

export const BuildDebugProvider = ({ children }: { children: ReactNode }) => {
  const { motors, getObjectMotors, objects, findMotor } = useProjectStore();
  const { motorSnapshots } = useControlledObjects();

  const [armed, setArmed] = useState(false);
  const [primaryMotorId, setPrimaryMotorId] = useState<number | null>(null);
  const [selectedMotorIds, setSelectedMotorIds] = useState<Set<number>>(() => new Set());
  const [pinnedMotorIds, setPinnedMotorIds] = useState<Set<number>>(() => new Set());
  /** 空集 = 默认全部解耦 */
  const [coupledObjectIds, setCoupledObjectIds] = useState<Set<number>>(() => new Set());
  const [stepMm, setStepMm] = useState<JogStep>(10);

  const snapshotById = useMemo(
    () => new Map(motorSnapshots.map((snapshot) => [snapshot.id, snapshot])),
    [motorSnapshots],
  );

  const arm = useCallback(() => setArmed(true), []);
  const disarm = useCallback(() => setArmed(false), []);

  const setPrimary = useCallback((motorId: number | null) => {
    setPrimaryMotorId(motorId);
    if (motorId) {
      setSelectedMotorIds((prev) => {
        if (prev.has(motorId)) return prev;
        const next = new Set(prev);
        next.add(motorId);
        return next;
      });
    }
  }, []);

  const toggleMotor = useCallback((motorId: number, additive = false) => {
    setSelectedMotorIds((prev) => {
      const next = new Set(additive ? prev : []);
      const removing = prev.has(motorId) && (additive || prev.size === 1);
      if (removing) next.delete(motorId);
      else next.add(motorId);

      const firstRemaining = next.values().next();
      const nextPrimary = firstRemaining.done ? null : firstRemaining.value;
      setPrimaryMotorId((primary) => {
        if (removing) {
          if (primary === motorId) return nextPrimary;
          if (primary && next.has(primary)) return primary;
          return nextPrimary;
        }
        if (!additive) return motorId;
        return primary && next.has(primary) ? primary : motorId;
      });
      return next;
    });
  }, []);

  const selectMotors = useCallback((motorIds: number[], primaryId?: number | null) => {
    const unique = [...new Set(motorIds)];
    setSelectedMotorIds(new Set(unique));
    setPrimaryMotorId(
      primaryId === undefined ? (unique[0] ?? null) : primaryId && unique.includes(primaryId) ? primaryId : (unique[0] ?? null),
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedMotorIds(new Set());
    setPrimaryMotorId(null);
  }, []);

  const togglePin = useCallback((motorId: number) => {
    setPinnedMotorIds((prev) => {
      const next = new Set(prev);
      if (next.has(motorId)) next.delete(motorId);
      else next.add(motorId);
      return next;
    });
  }, []);

  const isMotorOnline = useCallback(
    (motorId: number): boolean => snapshotById.get(motorId)?.live === true,
    [snapshotById],
  );

  const canToggleObjectCoupling = useCallback(
    (objectId: number) => getObjectMotors(objectId).some((motor) => isMotorOnline(motor.id)),
    [getObjectMotors, isMotorOnline],
  );

  const clearMotorsOfObjects = useCallback((objectIds: ReadonlySet<number> | number[]) => {
    const blocked = objectIds instanceof Set ? objectIds : new Set(objectIds);
    if (blocked.size === 0) return;
    setSelectedMotorIds((prev) => {
      const next = new Set(
        [...prev].filter((id) => {
          const objectId = findMotor(id)?.controlledObjectId;
          return objectId == null || !blocked.has(objectId);
        }),
      );
      if (next.size === prev.size) return prev;
      setPrimaryMotorId((primary) => (primary && next.has(primary) ? primary : (next.values().next().value ?? null)));
      return next;
    });
  }, [findMotor]);

  const isObjectDecoupled = useCallback(
    (objectId: number) => !coupledObjectIds.has(objectId),
    [coupledObjectIds],
  );

  const setObjectDecoupled = useCallback(
    (objectId: number, decoupled: boolean) => {
      if (!canToggleObjectCoupling(objectId)) return;
      setCoupledObjectIds((prev) => {
        const next = new Set(prev);
        if (decoupled) next.delete(objectId);
        else next.add(objectId);
        return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
      });
      if (!decoupled) clearMotorsOfObjects([objectId]);
    },
    [canToggleObjectCoupling, clearMotorsOfObjects],
  );

  const setAllObjectsDecoupled = useCallback(
    (decoupled: boolean) => {
      const eligibleIds = objects
        .filter((object) => canToggleObjectCoupling(object.id))
        .map((object) => object.id);
      if (eligibleIds.length === 0) return;

      if (decoupled) {
        setCoupledObjectIds((prev) => {
          const next = new Set(prev);
          for (const id of eligibleIds) next.delete(id);
          return next.size === prev.size ? prev : next;
        });
        return;
      }
      setCoupledObjectIds((prev) => {
        const next = new Set(prev);
        for (const id of eligibleIds) next.add(id);
        return next;
      });
      clearMotorsOfObjects(eligibleIds);
    },
    [objects, canToggleObjectCoupling, clearMotorsOfObjects],
  );

  const telemetryOf = useCallback(
    (motorId: number) => telemetryFromSnapshot(snapshotById.get(motorId)),
    [snapshotById],
  );

  const displayPositionOf = useCallback(
    (motorId: number) => snapshotById.get(motorId)?.actualPosition ?? 0,
    [snapshotById],
  );

  const imbalancedInObject = useCallback(
    (objectId: number): ReadonlySet<number> => {
      const objectMotors = getObjectMotors(objectId);
      const loads = objectMotors.map((motor) => ({
        id: motor.id,
        torque: snapshotById.get(motor.id)?.actualTorque ?? 0,
      }));
      return new Set(imbalancedTorqueMotorIds(loads));
    },
    [getObjectMotors, snapshotById],
  );

  const isMotorSelectable = useCallback(
    (motorId: number) => {
      if (!isMotorOnline(motorId)) return false;
      const objectId = findMotor(motorId)?.controlledObjectId;
      if (objectId == null) return true;
      return !coupledObjectIds.has(objectId);
    },
    [isMotorOnline, findMotor, coupledObjectIds],
  );

  // 指令下发暂不接 C++：以下均为静默 no-op
  const setEnabled = useCallback((_motorIds: number[], _enabled: boolean) => {}, []);
  const jogStart = useCallback((_dir: 1 | -1) => {}, []);
  const jogStop = useCallback(() => {}, []);
  const stop = useCallback(() => {}, []);
  const setOrigin = useCallback((_motorIds: number[]) => {}, []);
  const moveTo = useCallback((_position: number) => {}, []);
  const stepPrimary = useCallback((_dir: 1 | -1) => {}, []);

  // 物体列表变化时清理无效选中 / 耦合记录
  useEffect(() => {
    const ids = new Set(motors.map((m) => m.id));
    setSelectedMotorIds((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setPrimaryMotorId((prev) => (prev && ids.has(prev) ? prev : null));
    const objectIds = new Set(objects.map((object) => object.id));
    setCoupledObjectIds((prev) => {
      const next = new Set([...prev].filter((id) => objectIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [motors, objects]);

  const value = useMemo(
    (): BuildDebugContextValue => ({
      armed,
      primaryMotorId,
      selectedMotorIds,
      pinnedMotorIds,
      coupledObjectIds,
      stepMm,
      arm,
      disarm,
      setPrimary,
      toggleMotor,
      selectMotors,
      clearSelection,
      togglePin,
      setStep: setStepMm,
      isObjectDecoupled,
      canToggleObjectCoupling,
      setObjectDecoupled,
      setAllObjectsDecoupled,
      isMotorSelectable,
      telemetryOf,
      displayPositionOf,
      imbalancedInObject,
      isMotorOnline,
      setEnabled,
      jogStart,
      jogStop,
      stop,
      setOrigin,
      moveTo,
      stepPrimary,
    }),
    [
      armed,
      primaryMotorId,
      selectedMotorIds,
      pinnedMotorIds,
      coupledObjectIds,
      stepMm,
      arm,
      disarm,
      setPrimary,
      toggleMotor,
      selectMotors,
      clearSelection,
      togglePin,
      isObjectDecoupled,
      canToggleObjectCoupling,
      setObjectDecoupled,
      setAllObjectsDecoupled,
      isMotorSelectable,
      telemetryOf,
      displayPositionOf,
      imbalancedInObject,
      isMotorOnline,
      setEnabled,
      jogStart,
      jogStop,
      stop,
      setOrigin,
      moveTo,
      stepPrimary,
    ],
  );

  return <BuildDebugContext.Provider value={value}>{children}</BuildDebugContext.Provider>;
};
