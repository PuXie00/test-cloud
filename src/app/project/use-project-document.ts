import type { ProjectDocument } from "./project-document-types";
import { useProject } from "./use-project";

export const useProjectDocument = (): ProjectDocument | null =>
  useProject().currentProject?.document ?? null;
