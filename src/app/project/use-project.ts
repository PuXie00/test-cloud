import { useContext } from "react";
import {
  ProjectContext,
  type DocumentMutationOrigin,
  type DocumentRevision,
  type ProjectHistoryResult,
  type ProjectUpdateResult,
} from "./project-provider";

export type {
  DocumentMutationOrigin,
  DocumentRevision,
  ProjectHistoryResult,
  ProjectUpdateResult,
};

export const useProject = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
};
