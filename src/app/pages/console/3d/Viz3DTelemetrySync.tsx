import { useEffect, useMemo, useState } from "react";
import type { SceneObjectStatus, TelemetryDeviceType, TelemetrySnapshotInput, ToolMode } from "@/app/viz3d";
import { isTransformToolMode } from "@/app/viz3d";
import { ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE } from "@/app/project/configuration-rules";
import type { ControlledObjectStatus, ControlledObjectType } from "../components/monitor-grid/monitor-data";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/sequence-preview-provider";
import { memberObjectIds } from "../hooks/sequence-preview";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { useProjectStore } from "../hooks/use-project-store";
import { useViz3DContext } from "./Viz3DProvider";
import { selectSnapshotsForTelemetryApply } from "./telemetry-sync-select";

const STATUS_MAP: Record<ControlledObjectStatus, SceneObjectStatus> = {
  ready: "ready",
  running: "running",
  warning: "warning",
  alarm: "alarm",
  disabled: "disabled",
  offline: "offline",
};

const DEVICE_TYPE_MAP: Record<ControlledObjectType, TelemetryDeviceType> = {
  "lift-truss": "lift-truss",
  mover: "mover",
  rotator: "rotator",
  "lift-pitch": "lift-pitch",
};

export const Viz3DTelemetrySync = () => {
  const engine = useViz3DContext();
  const { objects } = useProjectStore();
  const { snapshots } = useControlledObjects();
  const { activeNav } = useConsoleNav();
  const { sequenceId, resolved } = useSequencePreview();
  const [mode, setMode] = useState<ToolMode>(() => engine.getMode());
  const [engineSelection, setEngineSelection] = useState<string[]>(() => engine.getSelection());

  const virtualAxisObjectIds = useMemo(
    () =>
      new Set(
        objects
          .filter((object) => ENABLED_VIRTUAL_AXES_BY_CONTROL_TYPE[object.controlType].length > 0)
          .map((object) => String(object.id)),
      ),
    [objects],
  );

  const previewSkipIds = useMemo(() => {
    if (activeNav !== "control" || sequenceId === null || !resolved) return new Set<string>();
    return new Set(memberObjectIds(resolved).map(String));
  }, [activeNav, sequenceId, resolved]);

  useEffect(() => {
    const handleMode = (next: ToolMode) => setMode(next);
    const handleSelection = (ids: string[]) => setEngineSelection(ids);

    engine.events.on("modeChange", handleMode);
    engine.events.on("selectionChange", handleSelection);

    return () => {
      engine.events.off("modeChange", handleMode);
      engine.events.off("selectionChange", handleSelection);
    };
  }, [engine]);

  useEffect(() => {
    const liveSnapshots = selectSnapshotsForTelemetryApply(snapshots, {
      transformMode: isTransformToolMode(mode),
      skipEngineObjectIds: isTransformToolMode(mode) ? new Set(engineSelection) : new Set(),
      skipObjectIds: previewSkipIds,
      resolveObjectId: (id) => engine.resolveObjectId(id) ?? undefined,
    });

    if (liveSnapshots.length === 0) return;

    const inputs: TelemetrySnapshotInput[] = [];
    for (const snapshot of liveSnapshots) {
      const objectId = String(snapshot.descriptor.id);
      const isVirtualAxis = virtualAxisObjectIds.has(objectId);

      if (activeNav !== "control") {
        if (isVirtualAxis) continue;
      }

      const input: TelemetrySnapshotInput = {
        snapshotId: objectId,
        name: snapshot.descriptor.name,
        status: STATUS_MAP[snapshot.descriptor.status],
        deviceType: DEVICE_TYPE_MAP[snapshot.descriptor.type],
        values: snapshot.values,
        speed: snapshot.speed,
        torquePercent: snapshot.torquePercent,
      };

      if (activeNav === "control" && isVirtualAxis) {
        if (!snapshot.positions) continue;
        const { h, p, y } = snapshot.positions;
        input.virtualAxisValues = {
          ...(h !== undefined ? { v1: h } : {}),
          ...(p !== undefined ? { v2: p } : {}),
          ...(y !== undefined ? { v3: y } : {}),
        };
      }

      inputs.push(input);
    }

    if (inputs.length > 0) engine.applyTelemetry(inputs);
  }, [engine, snapshots, mode, engineSelection, activeNav, virtualAxisObjectIds, previewSkipIds]);

  return null;
};
