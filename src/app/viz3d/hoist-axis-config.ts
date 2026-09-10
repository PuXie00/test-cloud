import type { HoistAxisConfig } from "./types";

export const hoistAxesEqual = (a?: HoistAxisConfig[], b?: HoistAxisConfig[]): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((axis, i) => {
    const other = b[i];
    return (
      axis.key === other.key &&
      axis.motorId === other.motorId &&
      axis.index === other.index &&
      axis.motorDisplayIndex === other.motorDisplayIndex &&
      axis.mount.x === other.mount.x &&
      axis.mount.z === other.mount.z
    );
  });
};
