import { useContext } from "react";
import { SelectionContext } from "./selection-context";

export type { ControlledObjectId, MotorId, SelectionContextValue } from "./selection-context";

export const useSelection = () => {
  const value = useContext(SelectionContext);
  if (!value) {
    throw new Error("useSelection must be used inside SelectionProvider");
  }
  return value;
};
