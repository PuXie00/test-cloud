import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { hexToColor3 } from "../babylon/utils";

export const PBR_MATERIAL_DEFAULTS = {
  roughness: 0.9,
  metalness: 0.4,
  envIntensity: 0.45,
} as const;

export type PbrMaterialOptions = {
  scene: Scene;
  name?: string;
  color?: Color3;
  alpha?: number;
  backFaceCulling?: boolean;
};

/** Lit material: diffuse + ambient fill so back faces are not pure black without IBL. */
export const applyMaterialBaseColor = (material: StandardMaterial, color: Color3): void => {
  material.diffuseColor = color.clone();
  material.ambientColor = color.clone().scaleInPlace(0.22);
};

export const createPbrStandardMaterial = (options: PbrMaterialOptions): StandardMaterial => {
  const material = new StandardMaterial(options.name ?? "viz3d-pbr", options.scene);
  if (options.color) {
    applyMaterialBaseColor(material, options.color);
  }
  material.specularColor = material.specularColor.scale(0.35);
  material.roughness = PBR_MATERIAL_DEFAULTS.roughness;
  if (options.alpha !== undefined) {
    material.alpha = options.alpha;
    material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  }
  if (options.backFaceCulling !== undefined) {
    material.backFaceCulling = options.backFaceCulling;
  }
  return material;
};

export const applyPbrMaterialDefaults = (material: StandardMaterial): void => {
  material.roughness = PBR_MATERIAL_DEFAULTS.roughness;
};

/**
 * Unlit solid-color material. Babylon PBR path ignores diffuseColor when lighting
 * is off — emissiveColor (or linkEmissiveWithDiffuse for textures) is required.
 */
export const createUnlitHexMaterial = (
  scene: Scene,
  name: string,
  hex: number,
): StandardMaterial => {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.roughness = 1;
  material.specularColor = Color3.Black();
  setUnlitHexMaterialColor(material, hex);
  return material;
};

export const setUnlitHexMaterialColor = (material: StandardMaterial, hex: number): void => {
  const color = hexToColor3(hex);
  material.emissiveColor = color;
  material.diffuseColor = color.clone();
};

export const configureUnlitTexturedMaterial = (material: StandardMaterial): void => {
  material.disableLighting = true;
  material.roughness = 1;
  material.specularColor = Color3.Black();
  // disableLighting 时最终色 ≈ emissive；须白底才能显示 diffuseTexture
  material.emissiveColor = Color3.White();
  material.diffuseColor = Color3.White();
  material.linkEmissiveWithDiffuse = true;
  if (material.diffuseTexture) {
    material.emissiveTexture = material.diffuseTexture;
  }
};
