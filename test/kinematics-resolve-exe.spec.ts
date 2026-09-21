import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveKinematicsExePathFrom } from "../shared/kinematics/resolve-exe";

const exeName = "YXZ.exe";

describe("resolveKinematicsExePathFrom", () => {
  it("prefers an explicit override path", () => {
    const override = path.resolve("/custom/solver.exe");
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        appDir: path.join("/electron", "dist"),
        appRoot: path.join("/project"),
        override,
        exists: () => false,
      }),
    ).toBe(override);
  });

  it("uses APP_ROOT when the electron dist directory has no exe", () => {
    const appRoot = path.join("F:", "yuezhong", "main", "console-txt");
    const appDir = path.join(appRoot, "node_modules", "electron", "dist");
    const atRoot = path.join(appRoot, exeName);
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        appDir,
        appRoot,
        exists: (filePath) => filePath === atRoot,
      }),
    ).toBe(atRoot);
  });

  it("uses the packaged app directory when the exe sits next to it", () => {
    const appDir = path.join("C:", "Program Files", "console-txt");
    const atApp = path.join(appDir, exeName);
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        appDir,
        appRoot: appDir,
        exists: (filePath) => filePath === atApp,
      }),
    ).toBe(atApp);
  });

  it("names the project-root path when the exe is missing", () => {
    const appRoot = path.join("F:", "yuezhong", "main", "console-txt");
    const appDir = path.join(appRoot, "node_modules", "electron", "dist");
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        appDir,
        appRoot,
        exists: () => false,
      }),
    ).toBe(path.join(appRoot, exeName));
  });
});
