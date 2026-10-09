import { useEffect, useRef } from "react";
import { useBuildDebugOptional } from "@/app/pages/console/components/build-debug/build-debug-context";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";

const sameIdSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export const Viz3DMotorSelectionSync = () => {
  const engine = useViz3DContext();
  const buildDebug = useBuildDebugOptional();
  const { treeFocus, setTreeFocus, replaceSelection } = useSelection();
  const applyingFromEngine = useRef(false);
  const applyingFromTree = useRef(false);
  const applyingFromBuild = useRef(false);
  const armed = buildDebug?.armed ?? false;

  // 搭建调试：3D 只点选 / 框选电机；其余为物体
  useEffect(() => {
    engine.setPickMode(armed ? "motor" : "object");
    return () => engine.setPickMode("object");
  }, [engine, armed]);

  useEffect(() => {
    const handleMotorSelection = (engineIds: string[]) => {
      if (applyingFromTree.current || applyingFromBuild.current) {
        return;
      }

      applyingFromEngine.current = true;
      if (buildDebug?.armed) {
        const ids = engineIds.map(Number).filter((id) => buildDebug.isMotorSelectable(id));
        if (ids.length === 0 && engineIds.length > 0) {
          // 只点到 / 框到不可选电机（离线或耦合中）：保持原选择
          applyingFromEngine.current = false;
          applyingFromBuild.current = true;
          engine.setMotorSelectionIds([...buildDebug.selectedMotorIds].map(String));
          applyingFromBuild.current = false;
          return;
        }
        if (ids.length === 0) {
          buildDebug.clearSelection();
          setTreeFocus(null);
          return;
        }
        const primary =
          buildDebug.primaryMotorId !== null && ids.includes(buildDebug.primaryMotorId)
            ? buildDebug.primaryMotorId
            : ids[0]!;
        buildDebug.selectMotors(ids, primary);
        setTreeFocus({ kind: "motor", id: primary });
        replaceSelection([]);
        return;
      }

      const first = engineIds[0];
      if (first) {
        setTreeFocus({ kind: "motor", id: Number(first) });
        replaceSelection([]);
      } else {
        setTreeFocus(null);
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
    if (armed) {
      return;
    }

    if (treeFocus?.kind === "motor") {
      const motorId = String(treeFocus.id);
      if (sameIdSet(engine.getMotorSelectionIds(), [motorId])) {
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
  }, [engine, treeFocus, armed]);

  // 武装后：调试选中集合 → 引擎，主选 → 树焦点
  const primary = buildDebug?.primaryMotorId ?? null;
  const selectedMotorIds = buildDebug?.selectedMotorIds;
  useEffect(() => {
    if (!armed || !selectedMotorIds) return;

    const engineIds = [...selectedMotorIds].map(String);
    if (!sameIdSet(engine.getMotorSelectionIds(), engineIds)) {
      applyingFromBuild.current = true;
      if (engineIds.length > 0) engine.clearSelection();
      engine.setMotorSelectionIds(engineIds);
      applyingFromBuild.current = false;
    }

    if (primary && (treeFocus?.kind !== "motor" || treeFocus.id !== primary)) {
      setTreeFocus({ kind: "motor", id: primary });
      replaceSelection([]);
    }
  }, [armed, primary, selectedMotorIds, engine, treeFocus, setTreeFocus, replaceSelection]);

  return null;
};
