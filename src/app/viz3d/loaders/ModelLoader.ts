import "@babylonjs/loaders";
import { ImportMeshAsync, type ISceneLoaderAsyncResult } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { createPbrStandardMaterial } from "../materials/pbr-material";
import type { LoadModelOptions, ModelFormat } from "../types";
import {
  getTemplateNativeSizeM,
  nativeSizeMToMm,
  normalizeFileExtentsToMeters,
  setTemplateNativeSizeM,
  type ModelNativeSizeMm,
} from "./model-native-size";
import { disposeNodeHierarchy, getWorldBounds } from "../babylon/utils";

type CacheEntry = {
  template: TransformNode;
  format: ModelFormat;
};

export const cacheKey = (input: File | string): string => {
  if (typeof input === "string") {
    return input;
  }
  return `${input.name}:${input.size}:${input.lastModified}`;
};

export const resolveModelCacheId = (
  input: File | string,
  opts: LoadModelOptions = {},
): string => opts.id ?? cacheKey(input);

export const detectFormat = (nameOrUrl: string, explicit?: ModelFormat): ModelFormat => {
  if (explicit) {
    return explicit;
  }
  const lower = nameOrUrl.toLowerCase();
  if (lower.endsWith(".glb")) {
    return "glb";
  }
  if (lower.endsWith(".gltf")) {
    return "gltf";
  }
  if (lower.endsWith(".obj")) {
    return "obj";
  }
  if (lower.endsWith(".stl")) {
    return "stl";
  }
  throw new Error(`Unsupported model format: ${nameOrUrl}`);
};

/**
 * Center content at origin and record native size (meters). No non-uniform stretch —
 * SceneObject applies a single uniform scale from width.
 */
const buildCenteredTemplate = (content: TransformNode, scene: Scene): TransformNode => {
  content.parent = null;
  content.computeWorldMatrix(true);
  const bounds = getWorldBounds(content);
  const fileExtents = {
    w: Math.max(bounds.max.x - bounds.min.x, 1e-6),
    h: Math.max(bounds.max.y - bounds.min.y, 1e-6),
    d: Math.max(bounds.max.z - bounds.min.z, 1e-6),
  };
  const native = normalizeFileExtentsToMeters(fileExtents);
  const fileMax = Math.max(fileExtents.w, fileExtents.h, fileExtents.d);
  const unitScale = fileMax > 50 ? 0.001 : 1;
  content.scaling.set(unitScale, unitScale, unitScale);
  content.computeWorldMatrix(true);
  const afterScale = getWorldBounds(content);
  const cx = (afterScale.min.x + afterScale.max.x) / 2;
  const cy = (afterScale.min.y + afterScale.max.y) / 2;
  const cz = (afterScale.min.z + afterScale.max.z) / 2;

  const template = new TransformNode("viz3d-model-template", scene);
  content.position.set(
    content.position.x - cx,
    content.position.y - cy,
    content.position.z - cz,
  );
  content.parent = template;
  setTemplateNativeSizeM(template, native);
  template.setEnabled(false);
  return template;
};

/** Parent every imported top-level node (incl. glTF `__root__`) under one content root. */
const wrapImportedContent = (
  result: ISceneLoaderAsyncResult,
  scene: Scene,
  name: string,
): TransformNode => {
  const root = new TransformNode(name, scene);
  const imported = new Set<Node>([...result.meshes, ...result.transformNodes]);
  for (const node of imported) {
    const parent = node.parent;
    if (!parent || !imported.has(parent)) {
      node.parent = root;
    }
  }
  return root;
};

export class ModelLoader {
  private readonly pending = new Map<string, Promise<CacheEntry>>();
  private readonly ready = new Map<string, TransformNode>();

  constructor(private readonly scene: Scene) {}

  async load(
    input: File | string,
    opts: LoadModelOptions = {},
  ): Promise<{ id: string; template: TransformNode; format: ModelFormat }> {
    const key = resolveModelCacheId(input, opts);
    const existing = this.pending.get(key);
    if (existing) {
      const entry = await existing;
      return { id: key, template: entry.template, format: entry.format };
    }

    const promise = this.loadFresh(input, opts);
    this.pending.set(key, promise);

    try {
      const entry = await promise;
      this.ready.set(key, entry.template);
      return { id: key, template: entry.template, format: entry.format };
    } catch (error) {
      this.pending.delete(key);
      throw error;
    }
  }

  get(id: string): TransformNode | undefined {
    return this.ready.get(id);
  }

  getNativeSizeMm(id: string): ModelNativeSizeMm | undefined {
    const template = this.ready.get(id);
    if (!template) return undefined;
    const native = getTemplateNativeSizeM(template);
    return native ? nativeSizeMToMm(native) : undefined;
  }

  ids(): string[] {
    return [...this.ready.keys()];
  }

  /** Dispose ready templates and drop pending/ready maps; loader stays usable. */
  clear(): void {
    this.ready.forEach((template) => disposeNodeHierarchy(template));
    this.ready.clear();
    this.pending.clear();
  }

  dispose(): void {
    this.clear();
  }

  private async loadFresh(input: File | string, opts: LoadModelOptions): Promise<CacheEntry> {
    const name = opts.name ?? (typeof input === "string" ? input : input.name);
    const format = detectFormat(name, opts.format);
    void opts.targetSize;
    const content = await this.parseInput(input, format, name);
    const template = buildCenteredTemplate(content, this.scene);
    return { template, format };
  }

  private async parseInput(
    input: File | string,
    format: ModelFormat,
    name: string,
  ): Promise<TransformNode> {
    if (typeof input === "string") {
      return this.loadFromUrl(input, format);
    }
    return this.loadFromFile(input, format, name);
  }

  private async loadFromUrl(url: string, format: ModelFormat): Promise<TransformNode> {
    const result = await ImportMeshAsync(url, this.scene);
    stripImportedAnimations(result);
    const root = wrapImportedContent(result, this.scene, "viz3d-model-content");
    if (format === "stl" && root.getChildMeshes().length === 0) {
      const mesh = MeshBuilder.CreateBox("viz3d-stl-fallback", { size: 1 }, this.scene);
      mesh.material = createPbrStandardMaterial({ scene: this.scene });
      mesh.parent = root;
    }
    return root;
  }

  /**
   * Babylon picks loader plugins from the filename extension.
   * Named File + pluginExtension avoids "Unable to find a plugin to load blob:".
   */
  private async loadFromFile(file: File, format: ModelFormat, name: string): Promise<TransformNode> {
    const named = await toNamedModelFile(file, format, name);
    const result = await ImportMeshAsync(named, this.scene, {
      pluginExtension: `.${format}`,
    });
    stripImportedAnimations(result);
    const root = wrapImportedContent(result, this.scene, name);
    if (format === "stl" && root.getChildMeshes().length === 0) {
      const mesh = MeshBuilder.CreateBox("viz3d-stl-fallback", { size: 1 }, this.scene);
      mesh.material = createPbrStandardMaterial({ scene: this.scene });
      mesh.parent = root;
    }
    return root;
  }
}

const stripImportedAnimations = (result: {
  animationGroups: Array<{ stop: () => void; dispose: () => void }>;
}): void => {
  for (const group of result.animationGroups) {
    group.stop();
    group.dispose();
  }
};

const toNamedModelFile = async (
  file: File,
  format: ModelFormat,
  name: string,
): Promise<File> => {
  const expected = `.${format}`;
  if (file.name.toLowerCase().endsWith(expected)) {
    return file;
  }
  const stem = name.replace(/\.[^.]+$/, "") || "model";
  const buffer = await file.arrayBuffer();
  return new File([buffer], `${stem}${expected}`, { type: file.type });
};
