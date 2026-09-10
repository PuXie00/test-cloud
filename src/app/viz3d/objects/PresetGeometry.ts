import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { PresetShape } from "../types";

export type Dimensions = { w: number; h: number; d: number };

export type PresetGeometryDescriptor =
  | { kind: "box"; params: { width: number; height: number; depth: number } }
  | { kind: "sphere"; params: { diameter: number; segments: number } }
  | {
      kind: "cylinder";
      params: { diameterTop: number; diameterBottom: number; height: number; tessellation: number };
    }
  | {
      kind: "torus";
      params: { diameter: number; thickness: number; tessellation: number };
    }
  | { kind: "sqRing"; params: { outer: number; inner: number; depth: number } };

export const resolvePresetGeometry = (
  shape: PresetShape,
  dims: Dimensions,
): PresetGeometryDescriptor => {
  switch (shape) {
    case "cube":
      return { kind: "box", params: { width: dims.w, height: dims.h, depth: dims.d } };
    case "sphere": {
      const diameter = Math.max(dims.w, dims.h, dims.d);
      return { kind: "sphere", params: { diameter, segments: 24 } };
    }
    case "cyl": {
      return {
        kind: "cylinder",
        params: { diameterTop: dims.w, diameterBottom: dims.w, height: dims.h, tessellation: 24 },
      };
    }
    case "prism6": {
      return {
        kind: "cylinder",
        params: { diameterTop: dims.w, diameterBottom: dims.w, height: dims.h, tessellation: 6 },
      };
    }
    case "ring": {
      const diameter = (dims.w * 75) / 100;
      const thickness = dims.h;
      return { kind: "torus", params: { diameter, thickness, tessellation: 32 } };
    }
    case "sqRing": {
      const outer = dims.w;
      const inner = dims.w * 0.6;
      return { kind: "sqRing", params: { outer, inner, depth: dims.h } };
    }
  }
};

export const createPresetMesh = (shape: PresetShape, dims: Dimensions, scene: Scene): Mesh => {
  const descriptor = resolvePresetGeometry(shape, dims);
  switch (descriptor.kind) {
    case "box": {
      const { width, height, depth } = descriptor.params;
      return MeshBuilder.CreateBox("viz3d-preset", { width, height, depth }, scene);
    }
    case "sphere": {
      const { diameter, segments } = descriptor.params;
      return MeshBuilder.CreateSphere("viz3d-preset", { diameter, segments }, scene);
    }
    case "cylinder": {
      const { diameterTop, diameterBottom, height, tessellation } = descriptor.params;
      return MeshBuilder.CreateCylinder(
        "viz3d-preset",
        { diameterTop, diameterBottom, height, tessellation },
        scene,
      );
    }
    case "torus": {
      const { diameter, thickness, tessellation } = descriptor.params;
      return MeshBuilder.CreateTorus(
        "viz3d-preset",
        { diameter, thickness, tessellation },
        scene,
      );
    }
    case "sqRing": {
      const { outer, inner, depth } = descriptor.params;
      const mesh = MeshBuilder.CreateBox(
        "viz3d-preset",
        { width: outer, height: depth, depth: outer },
        scene,
      );
      const hole = MeshBuilder.CreateBox(
        "viz3d-preset-hole",
        { width: inner, height: depth * 1.02, depth: inner },
        scene,
      );
      hole.parent = mesh;
      return mesh;
    }
  }
};
