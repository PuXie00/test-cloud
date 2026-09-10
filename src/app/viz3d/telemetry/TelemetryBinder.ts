export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ");

type NamedObject = { id: string; name: string };
type NamedSnapshot = { snapshotId: string; name: string };

export class TelemetryBinder {
  private readonly explicit = new Map<string, string>();
  private readonly byName = new Map<string, string>();

  bind(objectId: string, snapshotId: string): void {
    this.explicit.set(objectId, snapshotId);
  }

  unbind(objectId: string): void {
    this.explicit.delete(objectId);
  }

  syncFromNames(objects: NamedObject[], snapshots: NamedSnapshot[]): void {
    const nameToSnapshotId = new Map<string, string>();
    snapshots.forEach((snapshot) => {
      nameToSnapshotId.set(normalizeName(snapshot.name), snapshot.snapshotId);
    });

    this.byName.clear();
    objects.forEach((object) => {
      if (this.explicit.has(object.id)) {
        return;
      }
      const snapshotId = nameToSnapshotId.get(normalizeName(object.name));
      if (snapshotId) {
        this.byName.set(object.id, snapshotId);
      }
    });
  }

  resolveSnapshotId(objectId: string): string | null {
    return this.explicit.get(objectId) ?? this.byName.get(objectId) ?? null;
  }

  resolveObjectId(snapshotId: string): string | null {
    for (const [objectId, boundSnapshotId] of this.explicit.entries()) {
      if (boundSnapshotId === snapshotId) {
        return objectId;
      }
    }
    for (const [objectId, boundSnapshotId] of this.byName.entries()) {
      if (boundSnapshotId === snapshotId) {
        return objectId;
      }
    }
    return null;
  }
}
