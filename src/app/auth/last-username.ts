/** 本机记住上次登录的用户名（只是方便，不含密码）；读写失败就当没记住 */
export const LAST_USERNAME_STORAGE_KEY = "yz.auth.lastUsername";

export const readLastUsername = (): string => {
  try {
    return window.localStorage.getItem(LAST_USERNAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

export const writeLastUsername = (username: string): void => {
  try {
    window.localStorage.setItem(LAST_USERNAME_STORAGE_KEY, username);
  } catch {
    // 存不了只是下次要重新输用户名
  }
};
