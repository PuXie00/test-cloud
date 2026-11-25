/** 模型主文件、每个贴图各自的上限 */
export const MODEL_MAX_BYTES = 50 * 1024 * 1024;
/** 一个模型连同 .mtl、贴图合计的上限 */
export const MODEL_BUNDLE_MAX_BYTES = 100 * 1024 * 1024;
export const MODELS_PREFIX = "Models/";
/** OBJ 的 .mtl、贴图放在 Models 下的「<模型文件名>.assets」目录 */
export const MODEL_ASSETS_DIR_SUFFIX = ".assets";
/** 能显示的贴图格式（浏览器能解码的，加上 Babylon 自带的 TGA、DDS 解析） */
export const MODEL_TEXTURE_EXTENSIONS = ["png", "jpg", "jpeg", "bmp", "gif", "webp", "tga", "dds"] as const;

export const isAllowedModelFileName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".obj");
};

export const modelAssetsDirName = (fileName: string): string => `${fileName}${MODEL_ASSETS_DIR_SUFFIX}`;

/**
 * 附件文件名：不带路径，Windows 能建；
 * 不含 % # ? 和空白：Babylon 按 file: 名字查附件时会 decodeURIComponent，MTL 贴图名按空白切分。
 */
export const isSafeAssetFileName = (name: string): boolean =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 200 &&
  !name.endsWith(".") &&
  !/[\\/%#?\s<>:"|*]/.test(name) &&
  [...name].every((ch) => ch.charCodeAt(0) >= 0x20);

export const isModelTextureFileName = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return (MODEL_TEXTURE_EXTENSIONS as readonly string[]).includes(ext);
};

export const normalizeModelId = (input: string): string | null => {
  const trimmed = input.trim().replace(/\\/g, "/");
  const base = trimmed.includes("/")
    ? trimmed.startsWith(MODELS_PREFIX)
      ? trimmed.slice(MODELS_PREFIX.length)
      : null
    : trimmed;
  if (base === null || !base || base.includes("/") || base.includes("..")) return null;
  if (!isAllowedModelFileName(base)) return null;
  return `${MODELS_PREFIX}${base}`;
};

export const allocateUniqueFileName = (
  desiredName: string,
  existingNames: readonly string[],
): string => {
  const existing = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!existing.has(desiredName.toLowerCase())) return desiredName;
  const dot = desiredName.lastIndexOf(".");
  const stem = dot >= 0 ? desiredName.slice(0, dot) : desiredName;
  const ext = dot >= 0 ? desiredName.slice(dot) : "";
  let i = 1;
  while (existing.has(`${stem} (${i})${ext}`.toLowerCase())) i += 1;
  return `${stem} (${i})${ext}`;
};
