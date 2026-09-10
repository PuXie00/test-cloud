import { createContext, useContext, type ReactElement } from "react";

export type FormLayout = "vertical" | "horizontal";

export type FormCol = { span?: number; width?: number | string };

export type FormContextValue = {
  layout: FormLayout;
  labelCol?: FormCol;
  wrapperCol?: FormCol;
  labelWidth?: number | string;
  disabled?: boolean;
};

export const FormContext = createContext<FormContextValue>({
  layout: "vertical",
});

export const useFormLayout = () => useContext(FormContext);

export const resolveHorizontalGridColumns = (
  labelCol?: FormCol,
  wrapperCol?: FormCol,
  labelWidth?: number | string,
): string => {
  const width = labelWidth ?? labelCol?.width;
  if (width != null) {
    return `${typeof width === "number" ? `${width}px` : width} 1fr`;
  }
  return `${labelCol?.span ?? 8}fr ${wrapperCol?.span ?? 16}fr`;
};

export type ControlMeta = {
  valuePropName: string;
  trigger: string;
};

const resolveComponentSlot = (child: ReactElement): string | undefined => {
  const propSlot = (child.props as { "data-slot"?: string })["data-slot"];
  if (propSlot) return propSlot;

  const type = child.type;
  if (typeof type === "function" || (typeof type === "object" && type !== null)) {
    const named = type as { displayName?: string; name?: string };
    const label = named.displayName ?? named.name;
    if (label === "Select" || label === "select") return "select";
  }

  return undefined;
};

export const resolveControlMeta = (
  child: ReactElement,
  override?: Partial<ControlMeta>,
): ControlMeta => {
  if (override?.valuePropName && override?.trigger) {
    return { valuePropName: override.valuePropName, trigger: override.trigger };
  }

  const slot = resolveComponentSlot(child);

  switch (slot) {
    case "checkbox":
      return { valuePropName: "checked", trigger: "onCheckedChange" };
    case "select":
      return { valuePropName: "value", trigger: "onValueChange" };
    default:
      return {
        valuePropName: override?.valuePropName ?? "value",
        trigger: override?.trigger ?? "onChange",
      };
  }
};
