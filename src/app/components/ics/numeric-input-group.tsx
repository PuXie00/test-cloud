import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";
import type { NumericInputJoin, NumericInputProps } from "./numeric-input";

export type { NumericInputJoin };

export type NumericInputGroupProps = {
  className?: string;
  children: ReactNode;
};

const resolveJoin = (index: number, count: number): NumericInputJoin => {
  if (count <= 1) {
    return "single";
  }
  if (index === 0) {
    return "first";
  }
  if (index === count - 1) {
    return "last";
  }
  return "middle";
};

export const NumericInputGroup = ({ className, children }: NumericInputGroupProps) => {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<
    NumericInputProps & { join?: NumericInputJoin }
  >[];

  if (items.length <= 1) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      className={cn(
        className,
      )}
    >
      {items.map((child, index) =>
        cloneElement(child, { join: resolveJoin(index, items.length) }),
      )}
    </div>
  );
};
