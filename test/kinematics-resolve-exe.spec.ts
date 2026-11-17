import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  kinematicsExeName,
  resolveKinematicsExePathFrom,
  resolveKinematicsWorkDirFrom,
} from "../shared/kinematics/resolve-exe";

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
      // 函数会 path.resolve 项目目录；Linux 上 F: 开头不算绝对路径
    ).toBe(path.join(path.resolve(projectDir), exeName));
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

describe("kinematicsExeName", () => {
  it("Windows 带 .exe，Linux 版没有扩展名", () => {
    expect(kinematicsExeName("win32")).toBe("YXZ.exe");
    expect(kinematicsExeName("linux")).toBe("YXZ");
  });
});

describe("resolveKinematicsWorkDirFrom", () => {
  const userDataDir = path.join("/home", "op", ".config", "yzapp");

  it("Windows、开发态：程序所在目录（原来的做法）", () => {
    const exePath = path.join(installDir, exeName);
    expect(resolveKinematicsWorkDirFrom({ platform: "win32", dev: false, exePath, userDataDir })).toBe(installDir);
    const devExe = path.join(projectDir, "YXZ");
    expect(resolveKinematicsWorkDirFrom({ platform: "linux", dev: true, exePath: devExe, userDataDir })).toBe(projectDir);
  });

  it("Linux 打包版：程序在 /opt 下写不了，改用用户数据目录", () => {
    expect(
      resolveKinematicsWorkDirFrom({ platform: "linux", dev: false, exePath: "/opt/yzapp/YXZ", userDataDir }),
    ).toBe(path.join(userDataDir, "kinematics"));
  });
});
