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
