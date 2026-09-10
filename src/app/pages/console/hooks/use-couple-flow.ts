import { useCallback, useState } from "react";
import { isCppAckFailed } from "@shared/csocket/ack";
import type { CouplePreviewResult } from "./couple-preview";
import { classifyCouplePreview } from "./couple-preview";
import {
  KINEMATICS_ERROR_LABEL,
  objectHpy,
  motorPositionMap,
  prepareCoupleSolve,
  previewRowsFromSolverResults,
  orderCouplePreview,
  timeoutSolverPreview,
  toCoupleModelItems,
  type CouplePose,
} from "./couple-solve";
import { useControlledObjects } from "./use-controlled-objects";
import { useProjectStore } from "./use-project-store";

export type CoupleFlowPhase = "idle" | "solving" | "preview" | "error";

type SolverResultItem = {
  index: number;
  HPY?: number[];
  Motor_H?: number[];
  error?: string;
};

export const useCoupleFlow = (selectedIds: readonly number[]) => {
  const { objects, motors } = useProjectStore();
  const { motorSnapshots, getById } = useControlledObjects();
  const [phase, setPhase] = useState<CoupleFlowPhase>("idle");
  const [preview, setPreview] = useState<CouplePreviewResult | null>(null);
  const [poses, setPoses] = useState<CouplePose[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const reset = useCallback(() => {
    setPhase("idle");
    setPreview(null);
    setPoses([]);
    setErrorMessage("");
  }, []);

  const selectedObjects = selectedIds
    .map((id) => objects.find((object) => object.id === id))
    .filter((object): object is NonNullable<typeof object> => object !== undefined);

  const dispatchCouple = useCallback(
    async (
      items: {
        deviceId: number
        coupleFlag: 0 | 1
        hPosition?: number
        pPosition?: number
        yPosition?: number
      }[],
    ) => {
      const api = window.csocketApi;
      const result = await api.coupleModel(items);
      if (isCppAckFailed(result)) {
        setErrorMessage(String(result.message || "耦合指令下发失败"));
        setPhase("error");
        return;
      }
      reset();
    },
    [reset],
  );

  const handleDecouple = useCallback(() => {
    void dispatchCouple(
      selectedObjects.map((object) => ({ deviceId: object.id, coupleFlag: 0 as const })),
    );
  }, [dispatchCouple, selectedObjects]);

  const handleCouple = useCallback(async () => {
    const motorPositions = motorPositionMap(motorSnapshots);
    const hpyByObject = new Map(
      selectedObjects.map((object) => [object.id, objectHpy(getById(object.id))]),
    );
    const prepared = prepareCoupleSolve({
      objects: selectedObjects,
      motors,
      motorPositions,
      hpyByObject,
    });

    if (prepared.solverItems.length === 0) {
      const classified = classifyCouplePreview(prepared.skipRows);
      setPreview(classified);
      setPoses(prepared.skipPoses);
      setPhase("preview");
      return;
    }

    const kinematics = window.kinematicsApi;
    if (!kinematics?.solve) {
      setErrorMessage(KINEMATICS_ERROR_LABEL.EXE_NOT_FOUND);
      setPhase("error");
      return;
    }

    setPhase("solving");
    const result = await kinematics.solve(prepared.solverItems);
    if (!result.ok) {
      if (result.code === "SOLVE_TIMEOUT") {
        const mapped = timeoutSolverPreview({
          solverObjects: prepared.solverObjects,
          motors,
          motorPositions,
        });
        const ordered = orderCouplePreview(
          selectedObjects.map((object) => object.id),
          [...mapped.rows, ...prepared.skipRows],
          [...mapped.poses, ...prepared.skipPoses],
        );
        setPreview(classifyCouplePreview(ordered.rows, { timedOut: true }));
        setPoses(ordered.poses);
        setPhase("preview");
        return;
      }
      const fallback = KINEMATICS_ERROR_LABEL[result.code] ?? result.message;
      setErrorMessage(
        result.code === "SOLVE_ERROR" && result.message ? result.message : fallback,
      );
      setPhase("error");
      return;
    }

    const mapped = previewRowsFromSolverResults({
      solverObjects: prepared.solverObjects,
      motors,
      motorPositions,
      results: result.data as SolverResultItem[],
    });
    const ordered = orderCouplePreview(
      selectedObjects.map((object) => object.id),
      [...mapped.rows, ...prepared.skipRows],
      [...mapped.poses, ...prepared.skipPoses],
    );
    const classified = classifyCouplePreview(ordered.rows);
    setPreview(classified);
    setPoses(ordered.poses);
    setPhase("preview");
  }, [getById, motorSnapshots, motors, selectedObjects]);

  const handleConfirmPreview = useCallback(() => {
    if (!preview?.confirmEnabled) return;
    void dispatchCouple(toCoupleModelItems(poses, 1));
  }, [dispatchCouple, poses, preview]);

  return {
    phase,
    preview,
    errorMessage,
    busy: phase === "solving",
    handleCouple,
    handleDecouple,
    handleConfirmPreview,
    reset,
  };
};
