import type { LoadModelOptions } from "@/app/viz3d/types";
import { getProjectAPI, unwrapResult } from "@/app/project/project-ipc";

type EngineLike = {
  loadModel: (input: File, opts?: LoadModelOptions) => Promise<string>;
  getModelIds: () => string[];
};

export const loadProjectModel = async (
  modelId: string,
  engine: EngineLike,
): Promise<void> => {
  const { data, fileName, ext } = unwrapResult(
    await getProjectAPI().models.read({ modelId }),
  );
  const file = new File([data], fileName, {
    type: ext === "glb" ? "model/gltf-binary" : "text/plain",
  });
  await engine.loadModel(file, {
    id: modelId,
    name: fileName,
    format: ext === "glb" ? "glb" : "obj",
  });
};

export const ensureProjectModelsLoaded = async (
  modelIds: readonly string[],
  engine: EngineLike,
): Promise<{ failed: string[] }> => {
  const unique = [...new Set(modelIds.filter((id) => id.trim().length > 0))];
  const loaded = new Set(engine.getModelIds());
  const failed: string[] = [];

  for (const modelId of unique) {
    if (loaded.has(modelId)) continue;
    try {
      await loadProjectModel(modelId, engine);
      loaded.add(modelId);
    } catch {
      failed.push(modelId);
    }
  }

  return { failed };
};
