import { useEffect, useMemo, useRef } from "react";
import type { VirtualAxisValues } from "@/app/project/project-document-types";
import { useSessionDisplayLengthUnit } from "@/app/project/display-length-unit-provider";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import { formatVirtualAxesCompact } from "../components/action-builder/virtual-axis-display";
import { useActionBuilder } from "../components/action-builder/use-action-builder";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/use-sequence-preview";
import { previewPosesAt } from "../hooks/sequence-preview";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { useProjectStore } from "../hooks/use-project-store";
import { collectActionPageDriveUnitLabels } from "./action-page-drive-unit-labels";
import { resolveMemberObjectIds } from "./membership-dim";
import { useActionPreviewPoses } from "./use-action-preview-poses";
import { useViz3DContext } from "./Viz3DProvider";
import { resolveVirtualAxisLabelValues } from "./virtual-axis-label-values";

export const Viz3DVirtualAxisLabelSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { dockMode, sequence } = useActionBuilder();
  const { snapshots } = useControlledObjects();
  const { objects } = useProjectStore();
  const display = useSessionDisplayLengthUnit();
  const poses = useActionPreviewPoses();
  const { sequenceId, cursorMs, resolved } = useSequencePreview();
  const labelledIdsRef = useRef(new Set<string>());

  const controlPreviewPoses = useMemo(
    () =>
      activeNav === "control" && sequenceId !== null && resolved
        ? previewPosesAt(resolved, cursorMs)
        : null,
    [activeNav, sequenceId, resolved, cursorMs],
  );

  const memberIds = useMemo(
    () =>
      resolveMemberObjectIds({
        activeNav,
        dockMode,
        sequence,
        allObjectIds: objects.map((object) => object.id),
        pickedObjectIds: [],
      }),
    [activeNav, dockMode, sequence, objects],
  );

  useEffect(() => {
    const applyLabels = (next: Map<string, string | null>) => {
      const nextIds = new Set<string>();
      for (const [id, text] of next) {
        if (text) nextIds.add(id);
        engine.showDriveUnitLabel(id, text ? { position: text } : null);
      }
      for (const id of labelledIdsRef.current) {
        if (!next.has(id)) engine.showDriveUnitLabel(id, null);
      }
      labelledIdsRef.current = nextIds;
    };

    if (activeNav === "sequences") {
      applyLabels(collectActionPageDriveUnitLabels(poses, objects, display, memberIds));
      return;
    }

    if (activeNav !== "control") {
      for (const id of labelledIdsRef.current) engine.showDriveUnitLabel(id, null);
      labelledIdsRef.current.clear();
      return;
    }

    const positionsById = new Map(
      snapshots.map((snapshot) => [snapshot.descriptor.id, snapshot.positions]),
    );
    const next = new Map<string, string | null>();
    for (const object of objects) {
      const axes = ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType];
      if (axes.length === 0) continue;
      const id = String(object.id);
      const previewPose = controlPreviewPoses?.get(object.id);
      const values: VirtualAxisValues = previewPose
        ? { v1: previewPose.v1, v2: previewPose.v2, v3: previewPose.v3 }
        : resolveVirtualAxisLabelValues({
            mode: "current",
            positions: positionsById.get(object.id) ?? null,
          });
      const text = formatVirtualAxesCompact(axes, values, display, undefined, object.controlType);
      next.set(id, text || null);
    }
    applyLabels(next);
  }, [engine, activeNav, snapshots, objects, display, poses, memberIds, controlPreviewPoses]);

  useEffect(() => {
    return () => {
      for (const id of labelledIdsRef.current) engine.showDriveUnitLabel(id, null);
    };
  }, [engine]);

  return null;
};
