import { createContext, useContext, useState, type ReactNode } from "react";
import {
  type DisplayLengthUnit,
  readStoredDisplayLengthUnit,
} from "./display-length-units";

const Ctx = createContext<DisplayLengthUnit | null>(null);

export const DisplayLengthUnitProvider = ({
  children,
  initialUnit,
}: {
  children: ReactNode;
  initialUnit?: DisplayLengthUnit;
}) => {
  const [sessionUnit] = useState<DisplayLengthUnit>(
    () => initialUnit ?? readStoredDisplayLengthUnit(),
  );
  return <Ctx.Provider value={sessionUnit}>{children}</Ctx.Provider>;
};

export const useSessionDisplayLengthUnit = (): DisplayLengthUnit => {
  const v = useContext(Ctx);
  if (v == null) {
    throw new Error("useSessionDisplayLengthUnit must be used within DisplayLengthUnitProvider");
  }
  return v;
};
