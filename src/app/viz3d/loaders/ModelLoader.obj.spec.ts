// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { FilesInputStore } from "@babylonjs/core/Misc/filesInputStore";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelLoader } from "./ModelLoader";

const OBJ_TEXT = [
  "mtllib box.mtl",
  "v 0 0 0",
  "v 1 0 0",
  "v 0 1 0",
  "vt 0 0",
  "vt 1 0",
  "vt 0 1",
  "usemtl wood",
  "f 1/1 2/2 3/3",
].join("\n");

const disposers: (() => void)[] = [];

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

const createLoader = () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const loader = new ModelLoader(scene);
  disposers.push(() => {
    loader.dispose();
    scene.dispose();
    engine.dispose();
  });
  return loader;
};

const loadBox = (loader: ModelLoader, id: string, texture: string) =>
  loader.load(new File([OBJ_TEXT], "box.obj"), {
    id,
    format: "obj",
    assets: [
      new File([`newmtl wood\nkd 1 0 0\nmap_kd ${texture}`], "box.mtl"),
      new File(["png"], texture),
    ],
  });

const diffuseOf = (loader: ModelLoader, id: string) => {
  const mesh = loader.get(id)!.getChildMeshes(false)[0];
  return mesh.material as StandardMaterial;
};

describe("ModelLoader OBJ with assets", () => {
  it("loads the MTL and textures from the model assets and releases them afterwards", async () => {
    const loader = createLoader();

    await loadBox(loader, "Models/box.obj", "wood.png");
    await loadBox(loader, "Models/box (1).obj", "wood.png");

    const first = diffuseOf(loader, "Models/box.obj");
    const second = diffuseOf(loader, "Models/box (1).obj");
    expect(first.diffuseColor.asArray()).toEqual([1, 0, 0]);
    // 同名贴图各用各的：引擎按 URL 缓存贴图
    const firstUrl = (first.diffuseTexture as Texture).url;
    const secondUrl = (second.diffuseTexture as Texture).url;
    expect(firstUrl).toMatch(/^file:viz3d-\d+-wood\.png$/);
    expect(secondUrl).toMatch(/^file:viz3d-\d+-wood\.png$/);
    expect(firstUrl).not.toBe(secondUrl);
    await vi.waitFor(() => expect(Object.keys(FilesInputStore.FilesToLoad)).toEqual([]));
  });

  it("keeps 3ds Max o/g meshes solid when an empty object shares the material", async () => {
    const loader = createLoader();
    const obj = [
      "mtllib box.mtl",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "v 0 0 1",
      "vn 0 0 1",
      "o A",
      "g A",
      "usemtl wood",
      "f 1//1 2//1 3//1",
      "o B",
      "g B",
      "usemtl wood",
      "f 1//1 2//1 4//1",
    ].join("\n");

    await loader.load(new File([obj], "stage.obj"), {
      id: "Models/stage.obj",
      format: "obj",
      assets: [new File(["newmtl wood\nkd 0.8 0.8 0.8\n"], "box.mtl")],
    });

    const solid = loader
      .get("Models/stage.obj")!
      .getChildMeshes(false)
      .filter((mesh) => mesh.getTotalIndices() > 0);
    expect(solid.length).toBeGreaterThan(0);
    for (const mesh of solid) {
      expect((mesh.material as StandardMaterial).pointsCloud).toBe(false);
    }
  });
});
