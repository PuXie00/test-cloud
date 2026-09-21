import path from "node:path";

export type ResolveKinematicsExeInput = {
  exeName: string;
  appDir: string;
  appRoot?: string;
  override?: string;
  exists: (filePath: string) => boolean;
};

export const resolveKinematicsExePathFrom = (
  input: ResolveKinematicsExeInput,
): string => {
  const override = input.override?.trim();
  if (override) return path.resolve(override);

  const appRoot = input.appRoot?.trim() ?? "";
  const candidates = [
    appRoot ? path.join(appRoot, input.exeName) : "",
    appRoot ? path.join(appRoot, "Runtime", input.exeName) : "",
    path.join(input.appDir, input.exeName),
    path.join(input.appDir, "Runtime", input.exeName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (input.exists(candidate)) return candidate;
  }
  return candidates[0] ?? path.join(input.appDir, input.exeName);
};
