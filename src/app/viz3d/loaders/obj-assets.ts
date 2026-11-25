import { ImportMeshAsync, type ISceneLoaderAsyncResult } from "@babylonjs/core/Loading/sceneLoader";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { FilesInputStore } from "@babylonjs/core/Misc/filesInputStore";
import type { Scene } from "@babylonjs/core/scene";
import { mapMtlTextureFiles } from "@shared/project/obj-mtl";

/** 贴图装完或失败才撤登记；有的坏图不报错，最多等这么久 */
const TEXTURE_SETTLE_TIMEOUT_MS = 30_000;

let loadSeq = 0;
let objQueue: Promise<unknown> = Promise.resolve();

type RegisteredAssets = { mtlKeys: string[]; textureKeys: string[] };

const isMtlFile = (file: File): boolean => file.name.toLowerCase().endsWith(".mtl");

/** Babylon 按 file: 后面的名字转小写查 FilesInputStore */
const storeKey = (name: string): string => name.toLowerCase();

const unregister = (keys: readonly string[]): void => {
  for (const key of keys) {
    delete FilesInputStore.FilesToLoad[key];
  }
};

/**
 * 贴图名加上本次加载的前缀再登记：引擎按 URL 缓存贴图，不同模型的同名贴图不能串用。
 * .mtl 的名字写在 OBJ 的 mtllib 里，原名登记。
 */
const registerAssets = async (assets: readonly File[]): Promise<RegisteredAssets> => {
  loadSeq += 1;
  const prefix = `viz3d-${loadSeq}-`;
  const textures = assets.filter((file) => !isMtlFile(file));
  const renamed = new Map(textures.map((file) => [storeKey(file.name), `${prefix}${file.name}`]));
  const mtlFiles = await Promise.all(
    assets.filter(isMtlFile).map(async (file) => {
      const text = mapMtlTextureFiles(await file.text(), (name) => renamed.get(storeKey(name)) ?? name);
      return new File([text], file.name);
    }),
  );

  const mtlKeys = mtlFiles.map((file) => {
    const key = storeKey(file.name);
    FilesInputStore.FilesToLoad[key] = file;
    return key;
  });
  const textureKeys = textures.map((file) => {
    const key = storeKey(`${prefix}${file.name}`);
    FilesInputStore.FilesToLoad[key] = file;
    return key;
  });
  return { mtlKeys, textureKeys };
};

const waitTextureSettled = (texture: BaseTexture): Promise<void> =>
  new Promise((resolve) => {
    const internal = texture.getInternalTexture();
    if (!internal || internal.isReady) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      internal.onLoadedObservable.remove(loaded);
      internal.onErrorObservable.remove(failed);
      resolve();
    };
    const loaded = internal.onLoadedObservable.addOnce(finish);
    const failed = internal.onErrorObservable.addOnce(finish);
    const timer = setTimeout(finish, TEXTURE_SETTLE_TIMEOUT_MS);
  });

const collectTextures = (result: ISceneLoaderAsyncResult): BaseTexture[] => {
  const textures = new Set<BaseTexture>();
  for (const mesh of result.meshes) {
    for (const texture of mesh.material?.getActiveTextures() ?? []) {
      textures.add(texture);
    }
  }
  return [...textures];
};

/** TGA、DDS 等贴图的解析器是异步装的，读文件发生在 ImportMeshAsync 返回之后 */
const releaseWhenTexturesSettled = (result: ISceneLoaderAsyncResult, keys: readonly string[]): void => {
  if (keys.length === 0) return;
  void Promise.all(collectTextures(result).map(waitTextureSettled)).then(() => unregister(keys));
};

/**
 * 带 .mtl、贴图的 OBJ：rootUrl 为 "file:" 时，Babylon 按文件名在 FilesInputStore 里找 .mtl 和贴图。
 * FilesInputStore 是全局的，.mtl 又只能原名登记，所以一次只装一个。
 */
export const importObjWithAssets = (
  scene: Scene,
  objFile: File,
  assets: readonly File[],
): Promise<ISceneLoaderAsyncResult> => {
  const run = async (): Promise<ISceneLoaderAsyncResult> => {
    const { mtlKeys, textureKeys } = await registerAssets(assets);
    try {
      const result = await ImportMeshAsync(objFile, scene, {
        pluginExtension: ".obj",
        rootUrl: "file:",
      });
      releaseWhenTexturesSettled(result, textureKeys);
      return result;
    } catch (error) {
      unregister(textureKeys);
      throw error;
    } finally {
      unregister(mtlKeys);
    }
  };
  const next = objQueue.then(run);
  objQueue = next.catch(() => undefined);
  return next;
};
