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
  treeFocus: ProjectSelection;
  setTreeFocus: (selection: ProjectSelection) => void;
};

export const SelectionContext = createContext<SelectionContextValue | null>(null);
