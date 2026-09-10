import type { SceneObjectStatus } from "../types";

export const canEditObjectFromStatus = (status?: SceneObjectStatus): boolean => status !== "running";
