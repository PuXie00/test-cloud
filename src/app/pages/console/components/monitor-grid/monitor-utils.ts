import type { ControlType } from "@/app/project/configuration-types";
import { decodeControlType } from "@/app/project/control-type-code";
import type { ProjectDocument } from "@/app/project/project-document-types";

/** 占位物体没有实时数据，不进监控 */
export const isMonitoredControlType = (controlType: ControlType): boolean =>
  controlType !== "staticProp";

/** 控制界面监控区是否尚无受控物体（不算占位物体）；objectCount 是没有文档时可监控物体的数量 */
export const isMonitorEmpty = (
  document: ProjectDocument | null | undefined,
  objectCount: number,
): boolean => {
  if (!document) return objectCount === 0;
  return !document.setup.controlledObjects.some((object) =>
    isMonitoredControlType(decodeControlType(object.controlType)),
  );
};

/** 控制界面监控区是否尚无电机 */
export const isMonitorMotorsEmpty = (motorCount: number): boolean => motorCount === 0;
