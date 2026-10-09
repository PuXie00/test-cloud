import { describe, expect, it, vi } from "vitest";
import type { SceneObjectConfig } from "../types";
import { SceneObjectRegistry, type SceneObjectHandle } from "./SceneObjectRegistry";

type FakeNode = { name: string; parent: FakeNode | null };

const config = (id: string, parentId: string | null = null): SceneObjectConfig => ({
  id,
  shape: "cube",
  dimensions: { w: 1, h: 1, d: 1 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  parentId,
});

const createRegistry = () => {
  const disposed: string[] = [];
  const factory = (initial: SceneObjectConfig): SceneObjectHandle => {
    let current = initial;
    const root: FakeNode = { name: `${initial.id}-root`, parent: null };
    const pivot: FakeNode = { name: `${initial.id}-pivot`, parent: root };
    return {
      id: initial.id,
      object3d: root,
      attachmentPivot: pivot,
      getConfig: () => current,
      applyConfig: (next: SceneObjectConfig) => {
        current = next;
      },
      setStatus: vi.fn(),
      dispose: () => {
        disposed.push(initial.id);
      },
    } as unknown as SceneObjectHandle;
  };
  const container = { add: vi.fn(), remove: vi.fn() };
  return { registry: new SceneObjectRegistry(container, factory), disposed };
};

const parentOf = (registry: SceneObjectRegistry, id: string) =>
  (registry.get(id)!.object3d as unknown as FakeNode).parent;

describe("SceneObjectRegistry mounts", () => {
  it("parents child roots to the parent's attachment pivot regardless of config order", () => {
    const { registry } = createRegistry();
    registry.sync([config("lamp", "truss"), config("truss")]);
    expect(parentOf(registry, "lamp")).toBe(registry.get("truss")!.attachmentPivot);
    expect(parentOf(registry, "truss")).toBeNull();
    expect(registry.getMountParent("lamp")?.id).toBe("truss");
  });

  it("re-links after a config change and treats cycles as top level", () => {
    const { registry } = createRegistry();
    registry.sync([config("a"), config("b")]);
    registry.get("b")!.applyConfig(config("b", "a"));
    registry.syncMountParents();
    expect(parentOf(registry, "b")).toBe(registry.get("a")!.attachmentPivot);

    registry.get("a")!.applyConfig(config("a", "b"));
    registry.syncMountParents();
    expect(parentOf(registry, "a")).toBeNull();
    expect(parentOf(registry, "b")).toBeNull();
  });

  it("detaches children before disposing a removed parent", () => {
    const { registry, disposed } = createRegistry();
    registry.sync([config("truss"), config("lamp", "truss")]);
    const lampRoot = registry.get("lamp")!.object3d as unknown as FakeNode;
    registry.sync([config("lamp", "truss")]);
    expect(disposed).toEqual(["truss"]);
    expect(lampRoot.parent).toBeNull();
  });

  it("leaves top-level objects under foreign parents (session groups) alone", () => {
    const { registry } = createRegistry();
    registry.sync([config("a")]);
    const group: FakeNode = { name: "group", parent: null };
    (registry.get("a")!.object3d as unknown as FakeNode).parent = group;
    registry.syncMountParents();
    expect(parentOf(registry, "a")).toBe(group);
  });
});
