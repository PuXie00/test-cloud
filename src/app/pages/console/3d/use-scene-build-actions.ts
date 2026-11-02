import { useCallback } from "react";
import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  FoldHorizontal,
  FoldVertical,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { AlignAxis, AlignEdge, TransformCenterPreset } from "@/app/viz3d";
import { useProjectStore } from "../hooks/use-project-store";
import { useViz3DContext } from "./Viz3DProvider";
import { persistPivotChanges, persistTransformPayloadsBatch } from "./viz3d-transform-persist";

/** 均布至少要有中间的物体可以动 */
export const SCENE_DISTRIBUTE_MIN_COUNT = 3;

/**
 * 对齐和均布按世界坐标轴来，和相机朝向无关，所以 X、Z 只给中心，不给会随视角变的「向左 / 向右」；
 * Y 始终朝上，顶部、底部的含义不变。颜色和属性面板的 X / Y / Z 一致。
 * 图标画的是物体移动的方向：X 横向、Y 纵向；Z 没有现成图标，把横向图形转 45° 表示纵深。
 */
export const SCENE_AXES: {
  axis: AlignAxis;
  letter: string;
  name: string;
  colorClass: string;
  iconClass?: string;
  distributeIcon: LucideIcon;
  edges: { edge: AlignEdge; label: string; icon: LucideIcon }[];
}[] = [
  {
    axis: "x",
    letter: "X",
    name: "左右",
    colorClass: "text-destructive",
    distributeIcon: AlignHorizontalSpaceAround,
    edges: [{ edge: "center", label: "中心", icon: FoldHorizontal }],
  },
  {
    axis: "y",
    letter: "Y",
    name: "高度",
    colorClass: "text-show",
    distributeIcon: AlignVerticalSpaceAround,
    edges: [
      { edge: "max", label: "顶部", icon: ArrowUpToLine },
      { edge: "center", label: "中心", icon: FoldVertical },
      { edge: "min", label: "底部", icon: ArrowDownToLine },
    ],
  },
  {
    axis: "z",
    letter: "Z",
    name: "前后",
    colorClass: "text-primary",
    iconClass: "-rotate-45",
    distributeIcon: AlignHorizontalSpaceAround,
    edges: [{ edge: "center", label: "中心", icon: FoldHorizontal }],
  },
];

export const useSceneBuildActions = () => {
  const engine = useViz3DContext();
  const { updateObject, updateObjectsBatch } = useProjectStore();

  const alignSelection = useCallback(
    (axis: AlignAxis, edge: AlignEdge) => {
      persistTransformPayloadsBatch(
        updateObjectsBatch,
        engine.align(engine.getSelection(), axis, edge),
      );
    },
    [engine, updateObjectsBatch],
  );

  const distributeSelection = useCallback(
    (axis: AlignAxis) => {
      const payloads = engine.distribute(engine.getSelection(), axis);
      if (payloads.length === 0) {
        toast.warning("位置没有变化：这些物体已经均布，或在这个方向上没有拉开距离");
        return;
      }
      persistTransformPayloadsBatch(updateObjectsBatch, payloads);
    },
    [engine, updateObjectsBatch],
  );

  const setTransformCenter = useCallback(
    (objectId: string, preset: TransformCenterPreset) => {
      const payload = engine.setTransformCenter(objectId, preset);
      if (!payload) {
        return;
      }
      persistPivotChanges(updateObject, [payload]);
    },
    [engine, updateObject],
  );

  return {
    alignSelection,
    distributeSelection,
    setTransformCenter,
  };
};
