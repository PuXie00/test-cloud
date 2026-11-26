/**
 * 遥测快照 ↔ 场景物体的对应关系。
 *
 * 场景物体 id 和快照 id 都是工程物体 id，直接按 id 对应；需要别的对应时用 bind 显式绑定。
 * 不按名字配对：物体可以重名，按名字会把一个物体的遥测、标签、选中套到另一个物体上。
 */
export class TelemetryBinder {
  private readonly explicit = new Map<string, string>();

  /** hasObject：场景里当前有没有这个 id 的物体 */
  constructor(private readonly hasObject: (objectId: string) => boolean) {}

  bind(objectId: string, snapshotId: string): void {
    this.explicit.set(objectId, snapshotId);
  }

  unbind(objectId: string): void {
    this.explicit.delete(objectId);
  }

  resolveSnapshotId(objectId: string): string | null {
    const bound = this.explicit.get(objectId);
    if (bound !== undefined) return bound;
    return this.hasObject(objectId) ? objectId : null;
  }

  resolveObjectId(snapshotId: string): string | null {
    for (const [objectId, boundSnapshotId] of this.explicit) {
      if (boundSnapshotId === snapshotId) return objectId;
    }
    // 同 id 的物体被显式绑到了别的快照，就不再按 id 对应
    if (this.hasObject(snapshotId) && !this.explicit.has(snapshotId)) return snapshotId;
    return null;
  }
}
