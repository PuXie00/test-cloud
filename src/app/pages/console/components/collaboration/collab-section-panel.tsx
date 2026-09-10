import type { ReactNode } from "react";
import { cn } from "@/app/components/ui/utils";
import { COLLAB_SURFACES } from "./collab-surfaces";

type CollabSectionPanelProps = {
  children: ReactNode;
  className?: string;
};

/** L4 section container — wraps content inside a CollabSection title */
export const CollabSectionPanel = ({ children, className }: CollabSectionPanelProps) => (
  <div className={cn("rounded-md p-4", COLLAB_SURFACES.section, className)}>{children}</div>
);
