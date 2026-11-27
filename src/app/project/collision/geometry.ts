import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphereVertexData } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Scene } from "@babylonjs/core/scene";
import { loadGeometryTemplate } from "@/app/viz3d/loaders/ModelLoader";
import { getTemplateNativeSizeM, uniformScaleForWidth } from "@/app/viz3d/loaders/model-native-size";
import { resolvePresetGeometry, buildPresetVertexData } from "@/app/viz3d/objects/PresetGeometry";
import { buildCollisionShape, type CollisionShape, type Triangle } from "./mesh-distance";
import type { CollisionAsset, CollisionObject } from "./types";

import { finishSteps, type RunSteps, type Steps } from "./worker-job";

export { shapeDistance, shapeDistanceSteps, shapeRadius, type CollisionShape } from "./mesh-distance";

function* appendFaces(
  faces: Triangle[], positions: ArrayLike<number>, indices?: ArrayLike<number> | null,
  matrix?: Matrix, scale = 1,
): Steps<void> {
  if (positions.length % 3 !== 0) throw Error("模型顶点数据不完整");
  const points: Vector3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 768 === 0) yield;
    const raw = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
    const point = (matrix ? Vector3.TransformCoordinates(raw, matrix) : raw).scaleInPlace(scale);
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw Error("模型顶点无效");
    points.push(point);
  }
  const count = indices?.length || points.length;
  if (count % 3 !== 0) throw Error("模型三角面数据不完整");
  for (let i = 0; i < count; i += 3) {
    if (i % 768 === 0) yield;
    const a = points[indices?.length ? indices[i] : i];
    const b = points[indices?.length ? indices[i + 1] : i + 1];
    const c = points[indices?.length ? indices[i + 2] : i + 2];
    if (!a || !b || !c) throw Error("模型索引无效");
    if (Vector3.Cross(b.subtract(a), c.subtract(a)).lengthSquared() > 0) faces.push([a, b, c]);
  }
};

/** Only triangle surfaces with their complete geometry in this asset can be verified. */
const supportedGlb = (bytes: Uint8Array): boolean => {
  if (bytes.length < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x46546c67 || jsonLength > bytes.length - 20) return false;
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    buffers?: { uri?: string }[];
    extensionsUsed?: string[];
    meshes?: { primitives: { mode?: number }[] }[];
  };
  return !gltf.buffers?.some(buffer => buffer.uri && !buffer.uri.startsWith("data:"))
    && !gltf.extensionsUsed?.some(ext => ["KHR_draco_mesh_compression", "EXT_meshopt_compression",
      "KHR_meshopt_compression", "EXT_mesh_gpu_instancing"].includes(ext))
    && !!gltf.meshes?.every(mesh => mesh.primitives.every(p => (p.mode ?? 4) === 4));
};

const externalShape = async (asset: CollisionAsset, width: number, run: RunSteps) => {
  if (asset.format === "glb" && !supportedGlb(asset.bytes)) return undefined;
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const template = await loadGeometryTemplate(asset.bytes, asset.format, scene);
    const native = getTemplateNativeSizeM(template);
    if (!native) return undefined;
    const scale = uniformScaleForWidth(native, width);
    return await run((function* (): Steps<CollisionShape | undefined> {
      const faces: Triangle[] = [];
      for (const mesh of template.getChildMeshes()) {
        if (!mesh.getTotalVertices()) continue;
        const positions = mesh.getPositionData(true, true);
        if (!positions) return undefined;
        yield* appendFaces(faces, positions, mesh.getIndices(), mesh.computeWorldMatrix(true), scale);
      }
      return yield* buildCollisionShape(faces, false);
    })());
  } finally {
    scene.dispose();
    engine.dispose();
  }
};

export const prepareCollisionShape = async (
  obj: CollisionObject, asset?: CollisionAsset, run: RunSteps = async steps => finishSteps(steps),
): Promise<CollisionShape | undefined> => {
  const { shape, dimensions, holeDimensions } = obj.config;
  try {
    if (obj.config.model || obj.modelKey !== undefined) {
      if (!asset || !Number.isFinite(dimensions.w) || dimensions.w <= 0) return undefined;
      return await externalShape(asset, dimensions.w, run);
    }
    if (![dimensions.w, dimensions.h, dimensions.d].every(v => Number.isFinite(v) && v > 0)) return undefined;
    if (holeDimensions && ![holeDimensions.w, holeDimensions.d].every(Number.isFinite)) return undefined;
    const desc = resolvePresetGeometry(shape, dimensions, holeDimensions);
    const data = desc.kind === "box" ? CreateBoxVertexData(desc.params)
      : desc.kind === "sphere" ? CreateSphereVertexData(desc.params)
      : desc.kind === "cylinder" ? CreateCylinderVertexData(desc.params)
      : buildPresetVertexData(desc);
    if (!data?.positions) return undefined;
    const faces: Triangle[] = [];
    await run(appendFaces(faces, data.positions, data.indices));
    return await run(buildCollisionShape(faces, true, desc.kind === "box"));
  } catch {
    return undefined;
  }
};
