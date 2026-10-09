import { describe, expect, it } from "vitest";
import { objectWorldPose } from "@/app/project/object-mount";
import type { ControlledObject } from "../components/right-sidebar/config-wizard/config-wizard-types";
import { computePastePositionsMm } from "../3d/object-clipboard";
import { buildObjectClipboardSnapshots } from "../3d/scene-object-edit";
import { cloneObjectsAt } from "./clone-objects";
import { applyObjectMount } from "./mount-objects";

const object = (
  id: number,
  overrides: Partial<ControlledObject> = {},
): ControlledObject =>
  ({
    id,
    name: `O${id}`,
    controlType: "singlePointMove",
    shapePreset: "cube",
    shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
    dimensions: { w: 1000, h: 1000, d: 1000 },
    position: { x: 0, y: 0, z: 0 },
    centerOffset: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    color: "#869398",
    maxAxisVelocity: 200,
    pulleyDistance: 0,
    modelRunDirection: 1,
    axes: [],
    params: {},
    ...overrides,
  }) as ControlledObject;

const railCar = object(1, { position: { x: 2000, y: 0, z: 0 }, controlType: "railCar" });
const lift = object(2, { position: { x: 2500, y: 1000, z: 0 } });
const truss = object(3, { position: { x: 0, y: 6000, z: 0 } });

describe("applyObjectMount", () => {
  it("mounts keeping world placement and unmounts back", () => {
    const mounted = applyObjectMount([railCar, lift], [2], 1);
    expect(mounted[1]).toMatchObject({ parentId: 1, position: { x: 500, y: 1000, z: 0 } });

    const unmounted = applyObjectMount(mounted, [2], null);
    expect(unmounted[1]).not.toHaveProperty("parentId");
    expect(unmounted[1]!.position).toEqual({ x: 2500, y: 1000, z: 0 });
  });

  it("returns the same array for no-ops and refuses cycles", () => {
    const objects = [railCar, { ...lift, parentId: 1 }];
    expect(applyObjectMount(objects, [2], 1)).toBe(objects);
    expect(applyObjectMount(objects, [1], 2)).toBe(objects);
    expect(applyObjectMount(objects, [1], 1)).toBe(objects);
  });

  it("only remounts the topmost of a selected parent + child", () => {
    const objects = [railCar, { ...lift, parentId: 1, position: { x: 500, y: 1000, z: 0 } }, truss];
    const next = applyObjectMount(objects, [1, 2], 3);
    expect(next[0]!.parentId).toBe(3);
    expect(next[1]!.parentId).toBe(1);
  });

  it("keeps only Y rotation for swing children under a rotated parent", () => {
    const tilted = object(5, { rotation: { x: 10, y: 0, z: 0 }, controlType: "staticProp" });
    const swing = object(6, { controlType: "fourPointSwing", position: { x: 0, y: -1000, z: 0 } });
    const next = applyObjectMount([tilted, swing], [6], 5);
    expect(next[1]!.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("copy / paste with mounts", () => {
  const objects = [
    railCar,
    { ...lift, parentId: 1, position: { x: 500, y: 1000, z: 0 } },
    truss,
  ];

  it("copies the subtree with roots in world coordinates", () => {
    const snapshots = buildObjectClipboardSnapshots(objects, [1]);
    expect(snapshots.map((snap) => snap.id)).toEqual([1, 2]);
    expect(snapshots[1]!.position).toEqual({ x: 500, y: 1000, z: 0 });

    const childOnly = buildObjectClipboardSnapshots(objects, [2]);
    expect(childOnly[0]).toMatchObject({ parentId: 1, position: { x: 2500, y: 1000, z: 0 } });
  });

  it("offsets only roots and remaps copied parents", () => {
    const snapshots = buildObjectClipboardSnapshots(objects, [1]);
    const positions = computePastePositionsMm(snapshots, null, 1);
    expect(positions).toEqual([
      { x: 3000, y: 0, z: 0 },
      { x: 500, y: 1000, z: 0 },
    ]);
    let nextId = 100;
    const created = cloneObjectsAt(snapshots, positions, objects, () => nextId++);
    expect(created[0]).not.toHaveProperty("parentId");
    expect(created[1]).toMatchObject({ id: 101, parentId: 100, position: { x: 500, y: 1000, z: 0 } });
  });

  it("re-mounts a lone copied child on its original parent", () => {
    const snapshots = buildObjectClipboardSnapshots(objects, [2]);
    const positions = computePastePositionsMm(snapshots, null, 1);
    const [copy] = cloneObjectsAt(snapshots, positions, objects, () => 200);
    expect(copy).toMatchObject({ parentId: 1, position: { x: 1500, y: 1000, z: 0 } });
    expect(objectWorldPose([...objects, copy!], 200)!.position).toEqual({ x: 3500, y: 1000, z: 0 });
  });
});
