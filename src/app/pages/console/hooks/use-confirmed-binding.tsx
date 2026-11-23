import { useCallback, useRef, useState } from "react";
import { AxisTypeRewriteConfirmDialog } from "../components/right-sidebar/axis-type-rewrite-confirm-dialog";
import type { Motor } from "../components/right-sidebar/config-wizard/config-wizard-types";
import {
  applyBindMotorsFromAxis,
  bindMotorsByAssignments,
  canBindMotorToObject,
  listAxisTypeRewrites,
  planAutoBind,
  type AutoBindPlan,
  type AxisTypeRewrite,
} from "./binding-utils";
import {
  applyMultiPointAxesConfiguration as previewMultiPointAxesConfiguration,
  type MultiPointAxesConfigurationInput,
} from "./setup-operations";
import { useProjectStore } from "./use-project-store";

/** cancelled：用户在轴类型改写确认中取消，未绑定 */
export type ConfirmedBindOutcome = "bound" | "rejected" | "cancelled";

export type ConfirmedMultiPointAxesResult = {
  applied: boolean;
  cancelled?: boolean;
  reason?: string;
};

/**
 * 绑定会按物体控制类型改写电机轴类型；有改写时先弹窗确认，取消则不绑定。
 * 调用方需渲染返回的 confirmDialog。
 */
export const useConfirmedBinding = () => {
  const {
    objects,
    plcs,
    motors,
    bindAxis,
    bindMotorsFromAxis,
    autoBindAxes,
    applyMultiPointAxesConfiguration,
  } = useProjectStore();
  const [pendingRewrites, setPendingRewrites] = useState<readonly AxisTypeRewrite[]>([]);
  const resolvePendingRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settlePending = useCallback((confirmed: boolean) => {
    const resolve = resolvePendingRef.current;
    resolvePendingRef.current = null;
    setPendingRewrites([]);
    resolve?.(confirmed);
  }, []);

  const confirmAxisTypeRewrites = useCallback(
    (nextMotors: readonly Motor[]): Promise<boolean> => {
      const rewrites = listAxisTypeRewrites(motors, nextMotors);
      if (rewrites.length === 0) return Promise.resolve(true);
      resolvePendingRef.current?.(false);
      setPendingRewrites(rewrites);
      return new Promise((resolve) => {
        resolvePendingRef.current = resolve;
      });
    },
    [motors],
  );

  const confirmBindAxis = useCallback(
    async (
      objectId: number,
      axisKey: string,
      motorId: number | null,
    ): Promise<ConfirmedBindOutcome> => {
      if (motorId !== null && canBindMotorToObject(objectId, motorId, objects, motors)) {
        const preview = bindMotorsByAssignments(objects, motors, [{ objectId, axisKey, motorId }]);
        if (!(await confirmAxisTypeRewrites(preview))) return "cancelled";
      }
      return bindAxis(objectId, axisKey, motorId) ? "bound" : "rejected";
    },
    [bindAxis, confirmAxisTypeRewrites, motors, objects],
  );

  const confirmBindMotorsFromAxis = useCallback(
    async (
      objectId: number,
      startAxisKey: string,
      motorIds: readonly number[],
    ): Promise<ConfirmedBindOutcome> => {
      const preview = applyBindMotorsFromAxis(objects, motors, objectId, startAxisKey, motorIds);
      if (preview.ok && !(await confirmAxisTypeRewrites(preview.motors))) return "cancelled";
      return bindMotorsFromAxis(objectId, startAxisKey, motorIds) ? "bound" : "rejected";
    },
    [bindMotorsFromAxis, confirmAxisTypeRewrites, motors, objects],
  );

  /** 取消时返回 null */
  const confirmAutoBind = useCallback(async (): Promise<AutoBindPlan | null> => {
    const plan = planAutoBind(objects, motors);
    if (plan.assignments.length > 0) {
      const preview = bindMotorsByAssignments(objects, motors, plan.assignments);
      if (!(await confirmAxisTypeRewrites(preview))) return null;
    }
    return autoBindAxes();
  }, [autoBindAxes, confirmAxisTypeRewrites, motors, objects]);

  const confirmApplyMultiPointAxesConfiguration = useCallback(
    async (
      objectId: number,
      input: MultiPointAxesConfigurationInput,
    ): Promise<ConfirmedMultiPointAxesResult> => {
      const preview = previewMultiPointAxesConfiguration({ objects, plcs, motors }, objectId, input);
      if (preview.applied && !(await confirmAxisTypeRewrites(preview.state.motors))) {
        return { applied: false, cancelled: true };
      }
      return applyMultiPointAxesConfiguration(objectId, input);
    },
    [applyMultiPointAxesConfiguration, confirmAxisTypeRewrites, motors, objects, plcs],
  );

  const handleConfirm = useCallback(() => settlePending(true), [settlePending]);
  const handleCancel = useCallback(() => settlePending(false), [settlePending]);

  const confirmDialog = (
    <AxisTypeRewriteConfirmDialog
      rewrites={pendingRewrites}
      motors={motors}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return {
    confirmBindAxis,
    confirmBindMotorsFromAxis,
    confirmAutoBind,
    confirmApplyMultiPointAxesConfiguration,
    confirmDialog,
  };
};
