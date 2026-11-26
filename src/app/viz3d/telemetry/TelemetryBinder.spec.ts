import { describe, expect, it } from "vitest";
import { TelemetryBinder } from "./TelemetryBinder";

const binderWith = (ids: string[]) => {
  const scene = new Set(ids);
  return new TelemetryBinder((id) => scene.has(id));
};

describe("TelemetryBinder", () => {
  it("按 id 对应快照和场景物体", () => {
    const binder = binderWith(["1", "2"]);
    expect(binder.resolveObjectId("1")).toBe("1");
    expect(binder.resolveObjectId("2")).toBe("2");
    expect(binder.resolveSnapshotId("1")).toBe("1");
    expect(binder.resolveSnapshotId("2")).toBe("2");
  });

  it("场景里没有的 id 对不上", () => {
    const binder = binderWith(["1"]);
    expect(binder.resolveObjectId("9")).toBeNull();
    expect(binder.resolveSnapshotId("9")).toBeNull();
  });

  it("显式绑定优先，被绑走的物体不再按 id 对应", () => {
    const binder = binderWith(["1", "2"]);
    binder.bind("1", "2");
    expect(binder.resolveObjectId("2")).toBe("1");
    expect(binder.resolveSnapshotId("1")).toBe("2");
    expect(binder.resolveObjectId("1")).toBeNull();

    binder.unbind("1");
    expect(binder.resolveObjectId("1")).toBe("1");
    expect(binder.resolveObjectId("2")).toBe("2");
  });
});
