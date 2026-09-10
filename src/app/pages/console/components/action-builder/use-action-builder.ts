import { useContext } from "react";
import { ActionBuilderContext } from "./action-builder-react-context";

export const useActionBuilder = () => {
  const context = useContext(ActionBuilderContext);
  if (!context) {
    throw new Error("useActionBuilder must be used within ActionBuilderProvider");
  }
  return context;
};
