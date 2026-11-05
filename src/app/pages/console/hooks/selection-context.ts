import { createContext } from "react";
import type { ProjectSelection } from "../components/right-sidebar/project-data";

export type ControlledObjectId = number;
export type MotorId = number;

export type SelectionContextValue = {
  selectedId: ControlledObjectId | null;
  select: (id: ControlledObjectId | null) => void;
  toggleMulti: (id: ControlledObjectId) => void;
  multiSelectedIds: ControlledObjectId[];
  multiSelectedMotorIds: MotorId[];
  toggleMultiMotor: (id: MotorId) => void;
  replaceMotorSelection: (ids: MotorId[]) => void;
  clearSelection: () => void;
  replaceSelection: (ids: ControlledObjectId[]) => void;
  /** 3D 再次点选同一物体时也会递增，用于取消时间轴块选择 */
  objectSelectGeneration: number;
  touchObjectSelection: () => void;
  treeFocus: ProjectSelection;
  setTreeFocus: (selection: ProjectSelection) => void;
  /** 这些物体选不中（如控制页、动作页的占位物体）；设置时已选中的也去掉 */
  setUnselectableObjectIds: (ids: ReadonlySet<ControlledObjectId>) => void;
};

export const SelectionContext = createContext<SelectionContextValue | null>(null);
