import type { ProjectAPI } from "@/types/electron";
import { createMemoryProjectAPI } from "./test-fixtures";

/** 测试中安装内存 projectAPI，并清空工程 session */
export const installMemoryProjectAPI = (): ProjectAPI => {
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
  const api = createMemoryProjectAPI() as unknown as ProjectAPI;
  window.projectAPI = api;
  return api;
};

export const uninstallMemoryProjectAPI = (): void => {
  // @ts-expect-error 测试清理
  delete window.projectAPI;
};
