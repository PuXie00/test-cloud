import { useEffect, useRef } from "react";
import { useBuildDebugOptional } from "@/app/pages/console/components/build-debug/build-debug-context";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DMotorSelectionSync = () => {
  const engine = useViz3DContext();
  const buildDebug = useBuildDebugOptional();
  const { treeFocus, setTreeFocus, replaceSelection } = useSelection();
  const applyingFromEngine = useRef(false);
  const applyingFromTree = useRef(false);
  const applyingFromBuild = useRef(false);

  useEffect(() => {
    const handleMotorSelection = (motorId: string | null) => {
      if (applyingFromTree.current || applyingFromBuild.current) {
        return;
      }

      applyingFromEngine.current = true;
      if (motorId) {
        const numericId = Number(motorId);
        setTreeFocus({ kind: "motor", id: numericId });
        replaceSelection([]);
        if (buildDebug?.armed) {
          if (buildDebug.isMotorSelectable(numericId)) {
            buildDebug.selectMotors([numericId], numericId);
          }
        }
      } else {
        setTreeFocus(null);
        if (buildDebug?.armed) {
          buildDebug.clearSelection();
        }
      }
    };

    engine.events.on("motorSelectionChange", handleMotorSelection);
    return () => {
      engine.events.off("motorSelectionChange", handleMotorSelection);
    };
  }, [engine, setTreeFocus, replaceSelection, buildDebug]);

  // 树焦点 → 引擎（未武装或非 build-debug 主路径）
  useEffect(() => {
    if (applyingFromEngine.current) {
      applyingFromEngine.current = false;
      return;
    }
    if (buildDebug?.armed) {
      return;
    }

    if (treeFocus?.kind === "motor") {
      const motorId = String(treeFocus.id);
      if (engine.getMotorSelection() === motorId) {
        return;
      }

      applyingFromTree.current = true;
      engine.clearSelection();
      engine.setMotorSelection(motorId);
      applyingFromTree.current = false;
      return;
    }

    if (engine.getMotorSelection() !== null) {
      applyingFromTree.current = true;
      engine.clearMotorSelection();
      applyingFromTree.current = false;
    }
  }, [engine, treeFocus, buildDebug?.armed]);

  // 武装后：主选 → 引擎 + 树焦点
  useEffect(() => {
    if (!buildDebug?.armed) return;

    const primary = buildDebug.primaryMotorId;
    if (primary) {
      const engineMotorId = String(primary);
      if (engine.getMotorSelection() !== engineMotorId) {
        applyingFromBuild.current = true;
        engine.clearSelection();
        engine.setMotorSelection(engineMotorId);
        applyingFromBuild.current = false;
      }
      if (treeFocus?.kind !== "motor" || treeFocus.id !== primary) {
        setTreeFocus({ kind: "motor", id: primary });
        replaceSelection([]);
      }
      return;
    }

    if (engine.getMotorSelection() !== null) {
      applyingFromBuild.current = true;
      engine.clearMotorSelection();
      applyingFromBuild.current = false;
    }
  }, [
    buildDebug?.armed,
    buildDebug?.primaryMotorId,
    engine,
    treeFocus,
    setTreeFocus,
    replaceSelection,
  ]);

  return null;
};
