import "./babylon-namespace";
import "./babylon.gridMaterial.min.js";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { PushMaterial } from "@babylonjs/core/Materials/pushMaterial";

export interface GridMaterial extends PushMaterial {
  mainColor: Color3;
  lineColor: Color3;
  gridRatio: number;
  gridOffset: Vector3;
  majorUnitFrequency: number;
  minorUnitVisibility: number;
  opacity: number;
  antialias: boolean;
}

export type GridMaterialConstructor = {
  new (name: string, scene?: Scene, forceGLSL?: boolean): GridMaterial;
};

const globalScope = globalThis as unknown as {
  BABYLON?: { GridMaterial?: GridMaterialConstructor };
};

export const GridMaterial = globalScope.BABYLON?.GridMaterial as GridMaterialConstructor;
