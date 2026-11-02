import type { WizardView } from "./wizard-state";

const STORAGE_PREFIX = "console.devices.wizard.view.";

const WIZARD_VIEWS: readonly WizardView[] = ["intro", "objects", "hardware", "binding", "review"];

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

/** 只记住每个工程看到哪一步；存不了也不影响使用 */
export const readStoredWizardView = (projectId: string): WizardView | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    return WIZARD_VIEWS.includes(raw as WizardView) ? (raw as WizardView) : null;
  } catch {
    return null;
  }
};

export const writeStoredWizardView = (projectId: string, view: WizardView) => {
  try {
    window.localStorage.setItem(storageKey(projectId), view);
  } catch {
    // 隐私模式等场景写不进去，下次按工程数据决定从哪开始
  }
};
