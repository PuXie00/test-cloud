import { useCallback, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Crosshair,
} from "lucide-react";
import type { AlignMode, TransformCenterPreset } from "@/app/viz3d";
import { useProjectStore } from "../hooks/use-project-store";
import { useViz3DContext } from "./Viz3DProvider";
import { persistPivotChanges, persistTransformPayloadsBatch } from "./viz3d-transform-persist";

export const SCENE_ALIGN_ACTIONS: {
  mode: AlignMode;
  label: string;
  colorClass: string;
  hoverClass: string;
  icon: LucideIcon;
}[] = [
  {
    mode: "left",
    label: "向左对齐",
    colorClass: "text-primary",
    hoverClass: "hover:bg-primary/15",
    icon: AlignStartVertical,
  },
  {
    mode: "hCenter",
    label: "水平置中",
    colorClass: "text-primary",
    hoverClass: "hover:bg-primary/15",
    icon: AlignCenterVertical,
  },
  {
    mode: "right",
    label: "向右对齐",
    colorClass: "text-primary",
    hoverClass: "hover:bg-primary/15",
    icon: AlignEndVertical,
  },
  {
    mode: "top",
    label: "向上对齐",
    colorClass: "text-show",
    hoverClass: "hover:bg-show/15",
    icon: AlignStartHorizontal,
  },
  {
    mode: "vCenter",
    label: "垂直置中",
    colorClass: "text-show",
    hoverClass: "hover:bg-show/15",
    icon: AlignCenterHorizontal,
  },
  {
    mode: "bottom",
    label: "向下对齐",
    colorClass: "text-show",
    hoverClass: "hover:bg-show/15",
    icon: AlignEndHorizontal,
  },
  {
    mode: "center",
    label: "双向置中",
    colorClass: "text-warning",
    hoverClass: "hover:bg-warning/15",
    icon: Crosshair,
  },
];

export const useSceneBuildActions = () => {
  const engine = useViz3DContext();
  const { updateObject, updateObjectsBatch } = useProjectStore();
  const memberGroupRef = useRef<Map<string, string>>(new Map());

  const persistAlign = useCallback(
    (payloads: ReturnType<typeof engine.align>) => {
      persistTransformPayloadsBatch(updateObjectsBatch, payloads);
    },
    [updateObjectsBatch],
  );

  const alignSelection = useCallback(
    (mode: AlignMode) => {
      const ids = engine.getSelection();
      persistAlign(engine.align(ids, mode));
    },
    [engine, persistAlign],
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

  const groupSelection = useCallback(() => {
    const ids = engine.getSelection();
    const groupId = engine.group(ids);
    if (groupId) {
      ids.forEach((id: string) => memberGroupRef.current.set(id, groupId));
    }
  }, [engine]);

  const ungroupSelection = useCallback(() => {
    const ids = engine.getSelection();
    const groupId = ids
      .map((id: string) => memberGroupRef.current.get(id))
      .find((gid: string | undefined): gid is string => gid !== undefined);
    if (groupId) {
      engine.ungroup(groupId);
      memberGroupRef.current.forEach((gid, memberId) => {
        if (gid === groupId) {
          memberGroupRef.current.delete(memberId);
        }
      });
      return;
    }
    const groups = engine.getGroups();
    if (groups.length > 0) {
      engine.ungroup(groups[0]);
    }
  }, [engine]);

  return {
    alignSelection,
    setTransformCenter,
    groupSelection,
    ungroupSelection,
  };
};
