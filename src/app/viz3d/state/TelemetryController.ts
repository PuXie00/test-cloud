import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  formatLengthFamily,
  type DisplayLengthUnit,
} from "@/app/project/display-length-units";
import type {
  DriveUnitLabelFields,
  TelemetrySnapshotInput,
} from "../types";
import { TelemetryBinder } from "../telemetry/TelemetryBinder";
import { resolveRuntimeTransform } from "../telemetry/TelemetryMapper";
import { resolveVirtualAxisTransform } from "../telemetry/virtual-axis-mapper";
import type { SceneObjectHandle } from "../objects/SceneObjectRegistry";
import type { DomLabelRenderer } from "../labels/DomLabelRenderer";
import { DriveUnitLabels } from "./DriveUnitLabels";

/** Format live drive-unit speed label from canonical mm/s (session display unit). */
export const formatTelemetryDriveSpeedLabel = (
  speedMmPerS: number,
  display: DisplayLengthUnit = "mm",
): string =>
  formatLengthFamily(speedMmPerS, "mm/s", display, { canonicalPrecision: 1 });

/** Default running-state drive-unit label fields (canonical telemetry → display text). */
export const buildDefaultDriveUnitLabelFields = (
  snapshot: Pick<TelemetrySnapshotInput, "name" | "speed" | "torquePercent">,
  display: DisplayLengthUnit = "mm",
): DriveUnitLabelFields => ({
  id: snapshot.name,
  speed: formatTelemetryDriveSpeedLabel(snapshot.speed, display),
  load: `${Math.round(snapshot.torquePercent)} %`,
});

type ObjectVisuals = {
  labels: DriveUnitLabels;
};

export type TelemetryRegistry = {
  list: () => SceneObjectHandle[];
  get: (id: string) => SceneObjectHandle | undefined;
};

export class TelemetryController {
  private readonly binder = new TelemetryBinder();
  private readonly visuals = new Map<string, ObjectVisuals>();
  private readonly externalLabels = new Map<string, DriveUnitLabelFields | null>();
  private readonly labelPositionScratch = new Vector3();
  private lastTelemetryAt = 0;
  private telemetryBurstTimer: ReturnType<typeof setTimeout> | null = null;
  /** Frozen session display unit; default mm for non-React/test usage. */
  private displayLengthUnit: DisplayLengthUnit = "mm";

  constructor(
    private readonly registry: TelemetryRegistry,
    private readonly labelRenderer: DomLabelRenderer,
    private readonly onInvalidate: () => void,
    private readonly onTelemetryBurst: (active: boolean) => void,
  ) {}

  getBinder(): TelemetryBinder {
    return this.binder;
  }

  setDisplayLengthUnit(unit: DisplayLengthUnit): void {
    this.displayLengthUnit = unit;
  }

  getDisplayLengthUnit(): DisplayLengthUnit {
    return this.displayLengthUnit;
  }

  bindTelemetry(objectId: string, snapshotId: string): void {
    this.binder.bind(objectId, snapshotId);
  }

  applyTelemetry(snapshots: TelemetrySnapshotInput[]): void {
    const objects = this.registry.list().map((handle) => ({
      id: handle.id,
      name: handle.getConfig().name ?? handle.id,
    }));

    const namedSnapshots = snapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      name: snapshot.name,
    }));

    this.binder.syncFromNames(
      objects.map((object) => ({ id: object.id, name: object.name })),
      namedSnapshots,
    );

    snapshots.forEach((snapshot) => {
      const objectId = this.binder.resolveObjectId(snapshot.snapshotId);
      if (!objectId) {
        return;
      }
      const handle = this.registry.get(objectId);
      if (!handle) {
        return;
      }
      this.applySnapshot(handle, snapshot);
    });

    this.markTelemetryActivity();
  }

  showDriveUnitLabel(id: string, fields: DriveUnitLabelFields | null): void {
    this.externalLabels.set(id, fields);
    const visuals = this.getVisuals(id);
    if (!fields) {
      visuals?.labels.update(null);
      this.onInvalidate();
      return;
    }

    const handle = this.registry.get(id);
    if (!handle) {
      return;
    }

    const nextVisuals = visuals ?? this.ensureVisuals(id);
    nextVisuals.labels.update(fields);
    this.syncLabelWorldPosition(handle, nextVisuals);
    this.onInvalidate();
  }

  syncLabelPositions(): void {
    for (const [id, visuals] of this.visuals) {
      if (!visuals.labels.entry.visible) {
        continue;
      }
      const handle = this.registry.get(id);
      if (!handle) {
        continue;
      }
      this.syncLabelWorldPosition(handle, visuals);
    }
  }

  dispose(): void {
    if (this.telemetryBurstTimer) {
      clearTimeout(this.telemetryBurstTimer);
      this.telemetryBurstTimer = null;
    }
    this.visuals.forEach((visual) => {
      visual.labels.dispose();
      this.labelRenderer.remove(visual.labels.entry);
    });
    this.visuals.clear();
  }

  private applySnapshot(handle: SceneObjectHandle, snapshot: TelemetrySnapshotInput): void {
    const base = handle.getConfig();
    const transform = snapshot.virtualAxisValues
      ? resolveVirtualAxisTransform(base, snapshot.virtualAxisValues)
      : resolveRuntimeTransform(base, snapshot);
    handle.setStatus(snapshot.status);
    handle.applyRuntimeTransform(transform);

    const visuals = this.ensureVisuals(handle.id);

    if (snapshot.status === "running") {
      visuals.labels.update(
        this.externalLabels.get(handle.id) ?? this.defaultLabelFields(snapshot),
      );
    } else {
      visuals.labels.update(this.externalLabels.get(handle.id) ?? null);
    }

    this.syncLabelWorldPosition(handle, visuals);

  }

  private syncLabelWorldPosition(handle: SceneObjectHandle, visuals: ObjectVisuals): void {
    const center = handle.getTransformCenterWorldPosition();
    visuals.labels.setWorldPosition(
      this.labelPositionScratch.set(center.x, center.y, center.z),
    );
  }

  private defaultLabelFields(snapshot: TelemetrySnapshotInput): DriveUnitLabelFields {
    return buildDefaultDriveUnitLabelFields(snapshot, this.displayLengthUnit);
  }

  private ensureVisuals(id: string): ObjectVisuals {
    const existing = this.visuals.get(id);
    if (existing) {
      return existing;
    }
    const labels = new DriveUnitLabels();
    this.labelRenderer.add(labels.entry);
    const created: ObjectVisuals = {
      labels,
    };
    this.visuals.set(id, created);
    return created;
  }

  private getVisuals(id: string): ObjectVisuals | undefined {
    return this.visuals.get(id);
  }

  private markTelemetryActivity(): void {
    this.lastTelemetryAt = Date.now();
    this.onTelemetryBurst(true);
    this.onInvalidate();
    if (this.telemetryBurstTimer) {
      clearTimeout(this.telemetryBurstTimer);
    }
    this.telemetryBurstTimer = setTimeout(() => {
      if (Date.now() - this.lastTelemetryAt >= 100) {
        this.onTelemetryBurst(false);
      }
    }, 120);
  }
}
