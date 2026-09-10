import type { ProjectDocument } from "../project-document-types";
import { PROJECT_SCHEMA_VERSION } from "../project-document-types";
import { MOTION_DEFAULTS } from "../configuration-rules";
import { createDefaultSavedView } from "../saved-view";

export const SH_BALLET_DOCUMENT: ProjectDocument = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  meta: {
    id: "sh-ballet",
    name: "上海大剧院-天鹅湖",
    createdAt: "2024-06-12T09:30:00Z",
    modifiedAt: "2024-09-18T11:05:00Z",
    author: "Tech_02",
    status: "active",
    wizard: {
      currentStep: "hardware",
      completedSteps: ["objects"],
      skippedSteps: ["hardware", "binding"],
      simulationOnly: true,
      wizardCompleted: false,
    },
  },
  setup: {
    plcs: [],
    motors: [],
    controlledObjects: [
      {
        id: 2,
        name: "舞台升降台 A",
        controlType: 2,
        enabledVirtualAxes: ["v1"],
        shapePreset: "cube",
        shapeDimensions: { width: 3000, height: 300, depth: 2000 },
        dimensions: { w: 3000, h: 300, d: 2000 },
        position: { x: 0, y: 0, z: 0 },
        centerOffset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "#dee3e6",
        pulleyDistance: 0,
        modelRunDirection: 1,
        driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
        maxAxisVelocity: 200,
        motionParams: { move: { ...MOTION_DEFAULTS.move } },
        params: {},
      },
      {
        id: 1,
        name: "旋转台 B",
        controlType: 10,
        enabledVirtualAxes: ["v1"],
        shapePreset: "cyl",
        shapeDimensions: { diameter: 1500, height: 200 },
        dimensions: { w: 1500, h: 200, d: 1500 },
        position: { x: 4000, y: 0, z: 0 },
        centerOffset: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        color: "#bac3ff",
        pulleyDistance: 0,
        modelRunDirection: 1,
        driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
        maxAxisVelocity: 60,
        motionParams: { rotation: { ...MOTION_DEFAULTS.rotation } },
        params: {},
      },
    ],
    alignment: {},
  },
  motion: {
    positionCues: [
      {
        id: "cue-curtain",
        name: "幕启",
        durationMs: 8000,
        targets: {
          "2": { v1: 2500 },
          "1": { v1: 0 },
        },
      },
    ],
    actionSequences: [],
    programs: [
      {
        id: "prog-ballet",
        name: "天鹅湖",
        chapters: [
          {
            id: "ch-1",
            name: "第一幕",
            items: [{ kind: "cue", refId: "cue-curtain" }],
          },
        ],
      },
    ],
  },
  rules: { rules: [] },
  view: createDefaultSavedView(),
  snapshots: [],
};
