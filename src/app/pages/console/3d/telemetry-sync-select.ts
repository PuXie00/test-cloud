import type { ControlledObjectSnapshot } from "../components/monitor-grid/monitor-data";

type SelectOptions = {
  transformMode: boolean;
  skipEngineObjectIds: Set<string>;
  resolveObjectId: (snapshotId: string) => string | undefined;
};

export const selectSnapshotsForTelemetryApply = (
  snapshots: readonly ControlledObjectSnapshot[],
  options: SelectOptions,
): ControlledObjectSnapshot[] =>
  snapshots.filter((snapshot) => {
    if (!snapshot.live) return false;
    if (!options.transformMode) return true;
    const objectId = options.resolveObjectId(String(snapshot.descriptor.id));
    if (!objectId) return true;
    return !options.skipEngineObjectIds.has(objectId);
  });
