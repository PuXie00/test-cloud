import type { Scene } from "@babylonjs/core/scene";
import type { Disposable } from "../types";

export type SceneEnvironmentHandle = Disposable;

export const createSceneEnvironment = (_scene: Scene): SceneEnvironmentHandle => {
  return {
    dispose() {
      // no external resources
    },
  };
};

/** 使用场景灯光提供照明，不依赖外网 IBL 资源。 */
export const applySceneEnvironment = (scene: Scene): void => {
  scene.environmentTexture = null;
  scene.environmentIntensity = 0;
};
