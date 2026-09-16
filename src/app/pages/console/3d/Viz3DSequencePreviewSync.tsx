import { useEffect, useMemo } from "react";
import { useConsoleNav } from "../hooks/use-console-nav";
import { useSequencePreview } from "../hooks/sequence-preview-provider";
import { previewGhostsAt, sampleSequencePaths } from "../hooks/sequence-preview";
import { useViz3DContext } from "./Viz3DProvider";

export const Viz3DSequencePreviewSync = () => {
  const engine = useViz3DContext();
  const { activeNav } = useConsoleNav();
  const { sequenceId, cursorMs, resolved } = useSequencePreview();
  const paths = useMemo(() => (resolved ? sampleSequencePaths(resolved) : null), [resolved]);
  useEffect(() => {
    if (activeNav !== "control" || sequenceId === null || !resolved || !paths) {
      engine.clearSequencePreview();
      return;
    }
    engine.setSequencePreview({
      paths: [...paths].map(([objectId, samples]) => ({ objectId: String(objectId), poses: samples.map((s) => s.pose) })),
      ghosts: previewGhostsAt(resolved, cursorMs).map((g) => ({ objectId: String(g.objectId), role: g.role, pose: g.pose })),
    });
  }, [engine, activeNav, sequenceId, resolved, paths, cursorMs]);
  useEffect(() => () => engine.clearSequencePreview(), [engine]);
  return null;
};
