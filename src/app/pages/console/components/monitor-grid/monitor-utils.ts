import type { ProjectDocument } from "@/app/project/project-document-types";

/** 控制界面监控区是否尚无受控物体 */
export const isMonitorEmpty = (
  document: ProjectDocument | null | undefined,
  objectCount: number,
): boolean => {
  if (!document) return objectCount === 0;
  return document.setup.controlledObjects.length === 0;
};

/** 控制界面监控区是否尚无电机 */
export const isMonitorMotorsEmpty = (motorCount: number): boolean => motorCount === 0;
