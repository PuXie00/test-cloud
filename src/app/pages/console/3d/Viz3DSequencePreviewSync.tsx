import { useCallback, useEffect, useMemo, useRef } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/sequence-preview-provider";
import { previewPosesAt, sampleSequencePaths } from "../hooks/sequence-preview";
import { useControlledObjects } from "../hooks/use-controlled-objects";
import { resolveLivePoses } from "./resolve-live-poses";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DSequencePreviewSync = () => {
  const engine = useViz3DContext();
  const { snapshots } = useControlledObjects();
  const { activeNav } = useConsoleNav();
  const { sequenceId, cursorMs, resolved } = useSequencePreview();
  const paths = useMemo(() => (resolved ? sampleSequencePaths(resolved) : null), [resolved]);
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
    if (activeNav !== "control" || sequenceId === null || !resolved || !paths) {
      engine.clearSequencePreview();
      restoreLivePoses(previewedIdsRef.current);
      previewedIdsRef.current = [];
      return;
    }
    engine.setSequencePreview({
      paths: [...paths].map(([objectId, samples]) => ({
        objectId: String(objectId),
        poses: samples.map((sample) => sample.pose),
      })),
    });
    const poses = previewPosesAt(resolved, cursorMs);
    const nextIds = [...poses.keys()];
    const dropped = previewedIdsRef.current.filter((id) => !poses.has(id));
    restoreLivePoses(dropped);
    for (const [objectId, pose] of poses) {
      engine.applyVirtualAxisPose(String(objectId), pose);
    }
    previewedIdsRef.current = nextIds;
  }, [engine, activeNav, sequenceId, resolved, paths, cursorMs, restoreLivePoses]);

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
