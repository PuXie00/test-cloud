import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { applyMaterialBaseColor, createPbrStandardMaterial } from "../materials/pbr-material";

/** GLB 的 PBRMaterial：不直接 import，避免为了类型检查把 PBR 整套打进来 */
type AlbedoMaterial = Material & { albedoColor: Color3 };

const isAlbedoMaterial = (material: Material): material is AlbedoMaterial =>
  material.getClassName() === "PBRMaterial" &&
  typeof (material as unknown as { albedoColor?: Color3 }).albedoColor?.copyFrom === "function";

/** 带任何贴图（颜色、法线、高光……）的材质保留原样；只染纯色材质 */
export const materialHasTexture = (material: Material): boolean =>
  material.getActiveTextures().length > 0;

const canTint = (material: Material): boolean =>
  !materialHasTexture(material) &&
  (material instanceof StandardMaterial || isAlbedoMaterial(material));

const setTintColor = (material: Material, color: Color3): void => {
  if (material instanceof StandardMaterial) {
    applyMaterialBaseColor(material, color);
  } else if (isAlbedoMaterial(material)) {
    material.albedoColor = color.clone();
  }
};

/**
 * 导入模型的物体颜色：
 * - 没贴图的材质换成物体颜色；带贴图的材质保留原样（贴图、颜色都不动）
 * - 没有材质的网格（OBJ 没带 MTL）用物体颜色的标准材质
 * 材质与模型模板、其它用同一模型的物体共用，所以按物体克隆一份再改；关掉染色时换回原材质。
 */
export class ModelTint {
  /** 被改过材质的网格 → 原材质 */
  private readonly originals = new Map<AbstractMesh, Material | null>();
  /** 原材质 → 本物体的染色副本；null 表示这份材质不染（带贴图或类型不认识） */
  private readonly tinted = new Map<Material, Material | null>();
  private fallback: StandardMaterial | null = null;
  /** 上次染的颜色；遥测频繁 setStatus 也会走到这里，颜色没变就不再遍历网格 */
  private applied: Color3 | null = null;

  constructor(private readonly scene: Scene) {}

  /** color 为 null 时恢复模型自己的材质 */
  apply(root: TransformNode, color: Color3 | null): void {
    if (!color) {
      if (this.applied) this.restore();
      return;
    }
    if (this.applied?.equals(color)) return;
    this.applied = color.clone();
    for (const mesh of root.getChildMeshes(false)) {
      const original = this.originals.has(mesh) ? this.originals.get(mesh)! : mesh.material;
      const next = original ? this.tintedFor(original) : this.fallbackMaterial();
      if (next === original) continue;
      if (!this.originals.has(mesh)) this.originals.set(mesh, original);
      if (mesh.material !== next) mesh.material = next;
    }
    for (const copy of this.tinted.values()) {
      if (copy && !(copy instanceof MultiMaterial)) setTintColor(copy, color);
    }
    if (this.fallback) applyMaterialBaseColor(this.fallback, color);
  }

  /** 换回原材质并销毁副本（只销毁副本自己，不碰共用贴图） */
  restore(): void {
    for (const [mesh, original] of this.originals) {
      if (!mesh.isDisposed()) mesh.material = original;
    }
    this.originals.clear();
    this.applied = null;
    this.disposeCopies();
  }

  /** 网格随模型 visual 一起销毁时调用：只清副本 */
  dispose(): void {
    this.originals.clear();
    this.applied = null;
    this.disposeCopies();
  }

  private disposeCopies(): void {
    for (const copy of new Set(this.tinted.values())) {
      copy?.dispose(false, false);
    }
    this.tinted.clear();
    this.fallback?.dispose(false, false);
    this.fallback = null;
  }

  private tintedFor(original: Material): Material {
    if (this.tinted.has(original)) return this.tinted.get(original) ?? original;
    let copy: Material | null = null;
    if (original instanceof MultiMaterial) {
      copy = this.tintedMulti(original);
    } else if (canTint(original)) {
      copy = original.clone(`${original.name}-tint`) ?? null;
    }
    this.tinted.set(original, copy);
    return copy ?? original;
  }

  private tintedMulti(original: MultiMaterial): MultiMaterial | null {
    const subs = original.subMaterials.map((sub) => (sub ? this.tintedFor(sub) : sub));
    if (subs.every((sub, index) => sub === original.subMaterials[index])) return null;
    const copy = new MultiMaterial(`${original.name}-tint`, this.scene);
    copy.subMaterials = subs;
    return copy;
  }

  private fallbackMaterial(): StandardMaterial {
    this.fallback ??= createPbrStandardMaterial({ scene: this.scene, name: "viz3d-model-tint" });
    return this.fallback;
  }
}
