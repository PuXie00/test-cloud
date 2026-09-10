import type { ProjectDocument } from "./project-document-types";

export const PROJECT_HISTORY_LIMIT = 100;

export type ProjectConfigurationSnapshot = Pick<
  ProjectDocument,
  "setup" | "motion" | "rules"
>;

export type ProjectConfigurationState = {
  id: string;
  snapshot: ProjectConfigurationSnapshot;
};

export type ProjectHistoryEntry = {
  state: ProjectConfigurationState;
  label: string;
  committedAt: number;
};

export type ActiveHistoryTransaction = {
  owner: string;
  label: string;
  before: ProjectConfigurationState;
};

export type ProjectHistoryState = {
  past: ProjectHistoryEntry[];
  future: ProjectHistoryEntry[];
  activeTransaction: ActiveHistoryTransaction | null;
  savedStateId: string | null;
};

export type ProjectHistoryTransition = {
  history: ProjectHistoryState;
  current: ProjectConfigurationState;
  label: string;
};

export const captureProjectConfiguration = (
  document: ProjectDocument,
): ProjectConfigurationSnapshot => ({
  setup: document.setup,
  motion: document.motion,
  rules: document.rules,
});

export const createProjectConfigurationState = (
  id: string,
  document: ProjectDocument,
): ProjectConfigurationState => ({
  id,
  snapshot: captureProjectConfiguration(document),
});

export const restoreProjectConfiguration = (
  document: ProjectDocument,
  snapshot: ProjectConfigurationSnapshot,
): ProjectDocument => ({
  ...document,
  setup: snapshot.setup,
  motion: snapshot.motion,
  rules: snapshot.rules,
});

export const areSemanticallyEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => areSemanticallyEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areSemanticallyEqual(leftRecord[key], rightRecord[key]),
  );
};

export const resetProjectHistory = (
  currentStateId: string,
  savedStateId: string | null,
): ProjectHistoryState => ({
  past: [],
  future: [],
  activeTransaction: null,
  savedStateId: savedStateId ?? currentStateId,
});

/** Keep past+future ≤ limit: drop oldest past first, then furthest future. */
const clampHistoryStacks = (
  past: ProjectHistoryEntry[],
  future: ProjectHistoryEntry[],
): { past: ProjectHistoryEntry[]; future: ProjectHistoryEntry[] } => {
  const total = past.length + future.length;
  if (total <= PROJECT_HISTORY_LIMIT) {
    return { past, future };
  }
  const overflow = total - PROJECT_HISTORY_LIMIT;
  if (overflow <= past.length) {
    return { past: past.slice(overflow), future };
  }
  return {
    past: [],
    future: future.slice(0, PROJECT_HISTORY_LIMIT),
  };
};

export const pushProjectHistory = (
  history: ProjectHistoryState,
  previous: ProjectConfigurationState,
  label: string,
  committedAt: number,
): ProjectHistoryState => {
  const { past } = clampHistoryStacks(
    [...history.past, { state: previous, label, committedAt }],
    [],
  );
  return {
    ...history,
    past,
    future: [],
    activeTransaction: null,
  };
};

export const undoProjectHistory = (
  history: ProjectHistoryState,
  current: ProjectConfigurationState,
  committedAt: number,
): ProjectHistoryTransition | null => {
  const target = history.past.at(-1);
  if (!target) return null;
  const { past, future } = clampHistoryStacks(
    history.past.slice(0, -1),
    [{ state: current, label: target.label, committedAt }, ...history.future],
  );
  return {
    current: target.state,
    label: target.label,
    history: {
      ...history,
      past,
      future,
      activeTransaction: null,
    },
  };
};

export const redoProjectHistory = (
  history: ProjectHistoryState,
  current: ProjectConfigurationState,
  committedAt: number,
): ProjectHistoryTransition | null => {
  const target = history.future[0];
  if (!target) return null;
  const { past, future } = clampHistoryStacks(
    [...history.past, { state: current, label: target.label, committedAt }],
    history.future.slice(1),
  );
  return {
    current: target.state,
    label: target.label,
    history: {
      ...history,
      past,
      future,
      activeTransaction: null,
    },
  };
};
