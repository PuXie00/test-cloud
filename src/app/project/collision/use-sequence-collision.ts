import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ActionSequenceConfig, ModelPose } from "../action-sequence/types";
import type { ProjectSetup } from "../project-document-types";
import { CollisionScanScheduler, IDLE } from "./scan-scheduler";
import type { CollisionSaveBatch } from "./types";

export function useSequenceCollision(
  sequence: ActionSequenceConfig | null,
  setup: ProjectSetup | null,
  projectKey: string | null,
  paused: boolean,
  readBasePoses: () => Map<number, Partial<ModelPose>>,
  savedBatch: CollisionSaveBatch | null,
) {
  const [, changed] = useReducer(n => n + 1, 0);
  const [modelRevision, setModelRevision] = useState(0);
  const objects = setup?.controlledObjects;
  const scheduler = useMemo(() => projectKey && objects ? new CollisionScanScheduler(objects, changed) : null,
    [projectKey, objects, modelRevision]);
  const read = useRef(readBasePoses);
  read.current = readBasePoses;

  useEffect(() => window.haAPI?.onModelsChanged?.(() => setModelRevision(n => n + 1)), []);
  useLayoutEffect(() => () => scheduler?.dispose(), [scheduler]);
  useLayoutEffect(() => { scheduler?.suspend(paused); }, [scheduler, paused]);
  useLayoutEffect(() => { scheduler?.select(sequence); }, [scheduler, sequence]);

  // A geometry change invalidates results; only a new successful save should initiate work.
  const current = useRef({ projectKey, scheduler });
  current.current = { projectKey, scheduler };
  useEffect(() => {
    const context = current.current;
    if (!savedBatch || savedBatch.projectKey !== context.projectKey || !context.scheduler) return;
    const poses = read.current();
    for (const saved of savedBatch.sequences) context.scheduler.request(saved, poses, true);
  }, [savedBatch]);

  const runFull = useCallback(() => {
    if (sequence && scheduler) scheduler.request(sequence, read.current(), false);
  }, [scheduler, sequence]);
  return { ...(scheduler?.state(sequence) ?? IDLE), runFull };
}
