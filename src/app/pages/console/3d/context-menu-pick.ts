import type { PickTarget } from "@/app/viz3d";

export const resolveContextMenuObjectId = (target: PickTarget | null): string | null =>
  target?.kind === "object" ? target.id : null;
