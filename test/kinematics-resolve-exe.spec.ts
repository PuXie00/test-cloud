import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveKinematicsExePathFrom } from "../shared/kinematics/resolve-exe";

const exeName = "YXZ.exe";
const projectDir = path.join("F:", "yuezhong", "main", "console-txt");
const installDir = path.join("C:", "Program Files", "console-txt");

describe("resolveKinematicsExePathFrom", () => {
  it("uses the project directory when IS_DEV", () => {
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        installDir,
        projectDir,
        dev: true,
      }),
    ).toBe(path.join(projectDir, exeName));
  });

  it("uses the install directory when not IS_DEV", () => {
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        installDir,
        projectDir,
        dev: false,
      }),
    ).toBe(path.join(installDir, exeName));
  });

  it("uses the install directory when development has no project directory", () => {
    expect(
      resolveKinematicsExePathFrom({
        exeName,
        installDir,
        dev: true,
      }),
    ).toBe(path.join(installDir, exeName));
  });
});
