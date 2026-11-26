// @vitest-environment jsdom
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_FALLBACK } from "../engine/ThemeBridge";
import type { SceneObjectConfig } from "../types";
import { SceneObject } from "./SceneObject";

const RED = new Color3(1, 0, 0);

const baseConfig: SceneObjectConfig = {
  id: "co-color",
  shape: "cube",
  dimensions: { w: 2, h: 1, d: 1 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
};

const hexOf = (color: Color3 | undefined): string | undefined => color?.toHexString().toLowerCase();

describe("SceneObject 颜色", () => {
  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  describe("预设形状", () => {
    it("改颜色直接改本体材质", () => {
      const object = new SceneObject(baseConfig, scene, THEME_FALLBACK);
      const material = object.getBodyMesh().material as StandardMaterial;
      expect(hexOf(material.diffuseColor)).toBe("#869398");

      object.applyConfig({ ...baseConfig, color: "#ff8800" });
      expect(object.getBodyMesh().material).toBe(material);
      expect(hexOf(material.diffuseColor)).toBe("#ff8800");
    });
  });

  describe("导入模型", () => {
    let template: TransformNode;
    let plain: StandardMaterial;
    let textured: StandardMaterial;
    let pbr: PBRMaterial;

    /** 模板：纯色材质 ×2 网格共用、带贴图材质、PBR 纯色、没有材质 */
    beforeEach(() => {
      template = new TransformNode("template", scene);
      plain = new StandardMaterial("plain", scene);
      plain.diffuseColor = RED.clone();
      textured = new StandardMaterial("textured", scene);
      textured.diffuseColor = RED.clone();
      textured.diffuseTexture = new Texture(null, scene);
      pbr = new PBRMaterial("pbr", scene);
      pbr.albedoColor = RED.clone();
      const meshes: Array<[string, StandardMaterial | PBRMaterial | null]> = [
        ["plain-a", plain],
        ["plain-b", plain],
        ["textured", textured],
        ["pbr", pbr],
        ["bare", null],
      ];
      for (const [name, material] of meshes) {
        const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
        mesh.material = material;
        mesh.parent = template;
      }
      template.setEnabled(false);
    });

    const modelConfig = (overrides: Partial<SceneObjectConfig> = {}): SceneObjectConfig => ({
      ...baseConfig,
      model: { id: "m1" },
      ...overrides,
    });

    const create = (config: SceneObjectConfig, id = config.id) =>
      new SceneObject({ ...config, id }, scene, THEME_FALLBACK, (modelId) =>
        modelId === "m1" ? template : undefined,
      );

    const meshOf = (object: SceneObject, name: string): AbstractMesh => {
      const mesh = object
        .getVisualRoot()
        .getChildMeshes(false)
        .find((item) => item.name.endsWith(name));
      if (!mesh) throw new Error(`mesh ${name} not found`);
      return mesh;
    };

    it("默认不染色：用模型自己的材质", () => {
      const object = create(modelConfig({ color: "#00ff00" }));
      expect(meshOf(object, "plain-a").material).toBe(plain);
      expect(meshOf(object, "textured").material).toBe(textured);
      expect(meshOf(object, "pbr").material).toBe(pbr);
      expect(meshOf(object, "bare").material).toBeNull();
    });

    it("打开染色：纯色部分换成物体颜色，带贴图的保留，模板材质不被改", () => {
      const object = create(modelConfig({ color: "#00ff00", tintModel: true }));

      const a = meshOf(object, "plain-a").material as StandardMaterial;
      const b = meshOf(object, "plain-b").material as StandardMaterial;
      expect(a).not.toBe(plain);
      expect(b).toBe(a); // 同一份原材质只克隆一次
      expect(hexOf(a.diffuseColor)).toBe("#00ff00");

      expect(meshOf(object, "textured").material).toBe(textured);
      expect(hexOf((meshOf(object, "pbr").material as PBRMaterial).albedoColor)).toBe("#00ff00");
      expect(
        hexOf((meshOf(object, "bare").material as StandardMaterial | null)?.diffuseColor),
      ).toBe("#00ff00");

      expect(hexOf(plain.diffuseColor)).toBe("#ff0000");
      expect(hexOf(textured.diffuseColor)).toBe("#ff0000");
      expect(hexOf(pbr.albedoColor)).toBe("#ff0000");
    });

    it("改颜色实时生效；关掉染色换回原材质并销毁副本", () => {
      const object = create(modelConfig({ color: "#00ff00", tintModel: true }));
      const copy = meshOf(object, "plain-a").material as StandardMaterial;

      object.applyConfig(modelConfig({ color: "#0000ff", tintModel: true }));
      expect(meshOf(object, "plain-a").material).toBe(copy);
      expect(hexOf(copy.diffuseColor)).toBe("#0000ff");

      object.applyConfig(modelConfig({ color: "#0000ff", tintModel: false }));
      expect(meshOf(object, "plain-a").material).toBe(plain);
      expect(meshOf(object, "pbr").material).toBe(pbr);
      expect(meshOf(object, "bare").material).toBeNull();
      expect(scene.materials).not.toContain(copy);
      expect(scene.materials).toContain(plain);
    });

    it("运行状态更新不会把染色冲掉", () => {
      const object = create(modelConfig({ color: "#00ff00", tintModel: true }));
      const copy = meshOf(object, "plain-a").material as StandardMaterial;
      object.setStatus("running");
      object.setStatus("ready");
      expect(meshOf(object, "plain-a").material).toBe(copy);
      expect(hexOf(copy.diffuseColor)).toBe("#00ff00");
    });

    it("两个物体共用一个模型，各染各的", () => {
      const first = create(modelConfig({ color: "#00ff00", tintModel: true }), "co-1");
      const second = create(modelConfig({ color: "#0000ff", tintModel: true }), "co-2");
      expect(hexOf((meshOf(first, "plain-a").material as StandardMaterial).diffuseColor)).toBe(
        "#00ff00",
      );
      expect(hexOf((meshOf(second, "plain-a").material as StandardMaterial).diffuseColor)).toBe(
        "#0000ff",
      );
    });

    it("销毁物体只销毁染色副本，模板材质和贴图还在", () => {
      const object = create(modelConfig({ color: "#00ff00", tintModel: true }));
      const copy = meshOf(object, "plain-a").material!;
      object.dispose();
      expect(scene.materials).not.toContain(copy);
      expect(scene.materials).toEqual(expect.arrayContaining([plain, textured, pbr]));
      expect(textured.diffuseTexture?.isDisposed?.() ?? false).toBe(false);
    });
  });
});
