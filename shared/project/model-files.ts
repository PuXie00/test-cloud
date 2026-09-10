export const MODEL_MAX_BYTES = 10 * 1024 * 1024;
export const MODELS_PREFIX = "Models/";

export const isAllowedModelFileName = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".obj");
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
