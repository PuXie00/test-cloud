import path from "node:path";

export type ResolveKinematicsExeInput = {
  exeName: string;
  /** 安装目录：Electron 可执行文件所在目录 */
  installDir: string;
  /** 项目目录：开发态 APP_ROOT */
  projectDir?: string;
  dev: boolean;
};

/** IS_DEV 用项目目录下的程序，否则用安装目录下的同名程序。 */
export const resolveKinematicsExePathFrom = (
  input: ResolveKinematicsExeInput,
): string => {
  if (input.dev) {
    const projectDir = input.projectDir?.trim();
    if (projectDir) return path.join(path.resolve(projectDir), input.exeName);
  }
  return path.join(input.installDir, input.exeName);
};

/** 运动学程序名：Windows 是 YXZ.exe，Linux 版没有扩展名 */
export const kinematicsExeName = (platform: string): string =>
  platform === "win32" ? "YXZ.exe" : "YXZ";

export type ResolveKinematicsWorkDirInput = {
  platform: string;
  dev: boolean;
  /** 运动学程序的完整路径 */
  exePath: string;
  /** 软件的用户数据目录 */
  userDataDir: string;
};

/**
 * 运动学程序的工作目录：软件在这里写 YXZ_call.json，程序以它为当前目录读，再把 YXZ.json 写到 call 文件里的 path（也是这里）。
 * Windows、开发态还是程序所在的目录；Linux 打包版程序在 /opt 下，普通用户写不了，改用用户数据目录下的 kinematics。
 */
export const resolveKinematicsWorkDirFrom = (
  input: ResolveKinematicsWorkDirInput,
): string =>
  input.platform === "win32" || input.dev
    ? path.dirname(input.exePath)
    : path.join(input.userDataDir, "kinematics");
