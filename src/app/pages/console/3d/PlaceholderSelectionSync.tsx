import { useEffect, useMemo } from "react";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useProjectStore } from "../hooks/use-project-store";
import { useSelection } from "../hooks/use-selection";
import { useViz3DContext } from "./Viz3DProvider";

/** 控制页、动作页里占位物体选不中（搭建页照常可选、可改） */
export const placeholderIdsForNav = (
  activeNav: string,
  objects: readonly Pick<ControlledObject, "id" | "controlType">[],
): number[] =>
  activeNav === "control" || activeNav === "sequences"
    ? objects.filter((object) => object.controlType === "staticProp").map((object) => object.id)
    : [];

/** 把选不中的占位物体交给选中状态和 3D 拾取：点选、框选、全选都跳过它们，进页面时已选中的也去掉 */
export const PlaceholderSelectionSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { objects } = useProjectStore();
  const { setUnselectableObjectIds } = useSelection();
  // 只在占位物体集合变化时更新（物体改个位置不算）
  const key = placeholderIdsForNav(activeNav, objects).join(",");

  const ids = useMemo(
    () => new Set(key === "" ? [] : key.split(",").map(Number)),
    [key],
  );

  useEffect(() => {
    setUnselectableObjectIds(ids);
    engine.setUnpickableObjects([...ids].map(String));
  }, [engine, ids, setUnselectableObjectIds]);

  return null;
};
