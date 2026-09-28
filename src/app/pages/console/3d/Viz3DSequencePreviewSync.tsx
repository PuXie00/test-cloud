import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/use-sequence-preview";
import { sampleSequencePaths } from "../hooks/sequence-preview";
import { previewPosesAtCursor, transitionPathSamples } from "../hooks/sequence-preview-timeline";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import type { SequencePreviewPath } from "@/app/viz3d/state/SequencePreviewController";
import { resolveLivePoses } from "./resolve-live-poses";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DSequencePreviewSync = () => {
  const engine = useViz3DContext();
  const { snapshots } = useControlledObjects();
  const { activeNav } = useConsoleNav();
  const { sequenceId, cursorMs, resolved, timeline } = useSequencePreview();
  const transitionPlan = timeline?.plan ?? null;
  const paths = useMemo<SequencePreviewPath[] | null>(() => {
    if (!resolved) return null;
    const program = [...sampleSequencePaths(resolved)].map(([objectId, samples]) => ({
      objectId: String(objectId),
      poses: samples.map((sample) => sample.pose),
    }));
    if (!transitionPlan) return program;
    const transition = [...transitionPathSamples(transitionPlan)].map(([objectId, poses]) => ({
      key: `${objectId}:transition`,
      objectId: String(objectId),
      poses,
      tone: "transition" as const,
    }));
    return [...program, ...transition];
  }, [resolved, transitionPlan]);
  const previewedIdsRef = useRef<number[]>([]);
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const restoreLivePoses = useCallback(
    (memberIds: readonly number[]) => {
      if (memberIds.length === 0) return;
      const live = resolveLivePoses(
        snapshotsRef.current.map((snapshot) => ({
          id: snapshot.descriptor.id,
          positions: snapshot.positions,
        })),
        new Set(memberIds),
      );
      for (const [objectId, pose] of live) {
        engine.applyVirtualAxisPose(String(objectId), pose);
      }
    },
    [engine],
  );

  useEffect(() => {
    const previewing =
      (activeNav === "control" || activeNav === "sequences") &&
      sequenceId !== null &&
      resolved !== null &&
      timeline !== null &&
      paths !== null;
    if (!previewing || !resolved || !timeline || !paths) {
      engine.clearSequencePreview();
      restoreLivePoses(previewedIdsRef.current);
      previewedIdsRef.current = [];
      return;
    }
    engine.setSequencePreview({ paths });
    const poses = previewPosesAtCursor(resolved, timeline, cursorMs);
    const nextIds = [...poses.keys()];
    const dropped = previewedIdsRef.current.filter((id) => !poses.has(id));
    restoreLivePoses(dropped);
    for (const [objectId, pose] of poses) {
      engine.applyVirtualAxisPose(String(objectId), pose);
    }
    previewedIdsRef.current = nextIds;
  }, [engine, activeNav, sequenceId, resolved, timeline, paths, cursorMs, restoreLivePoses]);

  useEffect(
    () => () => {
      engine.clearSequencePreview();
      restoreLivePoses(previewedIdsRef.current);
      previewedIdsRef.current = [];
    },
    [engine, restoreLivePoses],
  );

  return null;
};
