import { PROJECT_CURRENT_FOLDER_KEY, PROJECT_CURRENT_KEY } from "./project-constants";

export const getStoredCurrentFolderName = (): string | null => {
  try {
    const folder = window.sessionStorage.getItem(PROJECT_CURRENT_FOLDER_KEY);
    if (folder) return folder;
    // 忽略旧版 id 键，避免与 folderName 混淆
    window.sessionStorage.removeItem(PROJECT_CURRENT_KEY);
    return null;
  } catch {
    return null;
  }
};

export const setStoredCurrentFolderName = (folderName: string): void => {
  window.sessionStorage.setItem(PROJECT_CURRENT_FOLDER_KEY, folderName);
  try {
    window.sessionStorage.removeItem(PROJECT_CURRENT_KEY);
  } catch {
    // ignore
  }
};

export const clearStoredCurrentFolderName = (): void => {
  try {
    window.sessionStorage.removeItem(PROJECT_CURRENT_FOLDER_KEY);
    window.sessionStorage.removeItem(PROJECT_CURRENT_KEY);
  } catch {
    // ignore
  }
};

/** @deprecated 使用 getStoredCurrentFolderName */
export const getStoredCurrentProjectId = getStoredCurrentFolderName;
/** @deprecated 使用 setStoredCurrentFolderName */
export const setStoredCurrentProjectId = setStoredCurrentFolderName;
/** @deprecated 使用 clearStoredCurrentFolderName */
export const clearStoredCurrentProjectId = clearStoredCurrentFolderName;
