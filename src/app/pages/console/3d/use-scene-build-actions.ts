import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { AlignAxis, AlignEdge, AxisScreenDirections, TransformCenterPreset } from "@/app/viz3d";
import { useProjectStore } from "../hooks/use-project-store";
import { useViz3DContext } from "./Viz3DProvider";
import { persistPivotChanges, persistTransformPayloadsBatch } from "./viz3d-transform-persist";

/** 均布至少要有中间的物体可以动 */
export const SCENE_DISTRIBUTE_MIN_COUNT = 3;

/**
 * 对齐和均布按世界坐标轴来：X、Z 的边缘叫「最小 / 最大」（坐标值），不叫会随视角变的「向左 / 向右」；
 * Y 始终朝上，叫顶部、底部。颜色和属性面板的 X / Y / Z 一致。
 * 图标用常见的对齐图标（对齐线 + 色块）。X、Z 在屏幕上的走向随视角变（前视图、顶视图里 +X 在左边），
 * 所以它们的图标按横向画（图标右方 = 该轴正方向），再用 axisIconStyle 转到当前视图里的真实方向。
 */
export const SCENE_AXES: {
  axis: AlignAxis;
  letter: string;
  name: string;
  colorClass: string;
  /** 图标是否跟着视角转：X、Z 是，Y 始终朝上不用转 */
  followsView: boolean;
  distributeIcon: LucideIcon;
  edges: { edge: AlignEdge; label: string; icon: LucideIcon }[];
}[] = [
  {
    axis: "x",
    letter: "X",
    name: "左右",
    colorClass: "text-destructive",
    followsView: true,
    distributeIcon: AlignHorizontalDistributeCenter,
    edges: [
      { edge: "min", label: "最小", icon: AlignStartVertical },
      { edge: "center", label: "中心", icon: AlignCenterVertical },
      { edge: "max", label: "最大", icon: AlignEndVertical },
    ],
  },
  {
    axis: "y",
    letter: "Y",
    name: "高度",
    colorClass: "text-show",
    followsView: false,
    distributeIcon: AlignVerticalDistributeCenter,
    edges: [
      { edge: "max", label: "顶部", icon: AlignStartHorizontal },
      { edge: "center", label: "中心", icon: AlignCenterHorizontal },
      { edge: "min", label: "底部", icon: AlignEndHorizontal },
    ],
  },
  {
    axis: "z",
    letter: "Z",
    name: "前后",
    colorClass: "text-primary",
    followsView: true,
    distributeIcon: AlignHorizontalDistributeCenter,
    edges: [
      { edge: "min", label: "最小", icon: AlignStartVertical },
      { edge: "center", label: "中心", icon: AlignCenterVertical },
      { edge: "max", label: "最大", icon: AlignEndVertical },
    ],
  },
];

/** 当前主视图里 X、Z 的屏幕朝向；只在跨过 45° 档位时更新 */
export const useAxisScreenDirections = (): AxisScreenDirections => {
  const engine = useViz3DContext();
  const [directions, setDirections] = useState(() => engine.getAxisScreenDirections());

  useEffect(() => {
    const handleChange = (next: AxisScreenDirections) =>
      setDirections((current) => (current.x === next.x && current.z === next.z ? current : next));
    handleChange(engine.getAxisScreenDirections());
    engine.events.on("axisScreenChange", handleChange);
    return () => engine.events.off("axisScreenChange", handleChange);
  }, [engine]);

  return directions;
};

/** 把按横向画的图标转到该轴在屏幕上的方向；CSS 顺时针为正，屏幕角度逆时针为正 */
export const axisIconStyle = (
  axis: AlignAxis,
  followsView: boolean,
  directions: AxisScreenDirections,
): CSSProperties | undefined => {
  if (!followsView || axis === "y") return undefined;
  const degrees = directions[axis];
  return degrees === 0 ? undefined : { transform: `rotate(${-degrees}deg)` };
};

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
