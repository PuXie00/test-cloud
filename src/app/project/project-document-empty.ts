import {
  PROJECT_SCHEMA_VERSION,
  type ProjectDocument,
} from "./project-document-types";
import { createDefaultSavedView } from "./saved-view";

export const createEmptyDocument = (meta: {
  id: string;
  name: string;
  author: string;
}): ProjectDocument => {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    meta: {
      id: meta.id,
      name: meta.name,
      createdAt: now,
      modifiedAt: now,
      author: meta.author,
      status: "draft",
      wizard: {
        currentStep: "objects",
        completedSteps: [],
        skippedSteps: [],
        simulationOnly: true,
        wizardCompleted: false,
      },
    },
    setup: { plcs: [], motors: [], controlledObjects: [], alignment: {} },
    motion: { actionSequences: [], programs: [] },
    rules: { rules: [] },
    view: createDefaultSavedView(),
    snapshots: [],
  };
};
