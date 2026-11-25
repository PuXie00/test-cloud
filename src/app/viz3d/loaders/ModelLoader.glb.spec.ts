// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { ModelLoader } from "./ModelLoader";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const padTo4 = (length: number): number => Math.ceil(length / 4) * 4;

/** 只有一个三角形的最小 glTF 2.0 二进制 */
const buildTriangleGlb = (): Uint8Array<ArrayBuffer> => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  });
  const jsonBytes = new TextEncoder().encode(json);
  const jsonLength = padTo4(jsonBytes.byteLength);
  const binLength = padTo4(positions.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binLength;

  const glb = new Uint8Array(new ArrayBuffer(totalLength));
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  glb.fill(0x20, 20, 20 + jsonLength);
  glb.set(jsonBytes, 20);

  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  glb.set(new Uint8Array(positions.buffer), binStart + 8);
  return glb;
};

const disposers: (() => void)[] = [];

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

describe("ModelLoader GLB", () => {
  it("能加载 glTF 2.0 的 GLB 文件", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const loader = new ModelLoader(scene);
    disposers.push(() => {
      loader.dispose();
      scene.dispose();
      engine.dispose();
    });
    const file = new File([buildTriangleGlb()], "triangle.glb", { type: "model/gltf-binary" });

    const result = await loader.load(file, { id: "models/triangle.glb", format: "glb" });

    expect(result).toMatchObject({ id: "models/triangle.glb", format: "glb" });
    expect(loader.ids()).toEqual(["models/triangle.glb"]);
    expect(loader.getNativeSizeMm("models/triangle.glb")).toBeDefined();
  });
});
