import type {
  CurrentProjectSnapshotPayload,
  ProjectDocument,
  ProjectMeta,
  ProjectMotion,
} from "../project-document-types";
import { PROJECT_SCHEMA_VERSION } from "../project-document-types";
import { MOTION_DEFAULTS } from "../configuration-rules";
import { createDefaultSavedView } from "../saved-view";

const GZ_SETUP = {
  plcs: [
    {
      id: 14,
      masterTypeId: "AC810_1",
      ip: "192.168.1.100",
    },
    {
      id: 1,
      masterTypeId: "AC810_1",
      ip: "192.168.1.101",
    },
  ],
  motors: [
    {
      id: 2,
      productModel: "YZ_AXIS_HOIST_500KG",
      plcId: 14,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: "1.1",
      controlledObjectId: 7,
      axisKey: "0",
      params: {
        workingStroke: 253,
        maxAxisVelocity: 500,
        reductionRatio: 15,
        axisDirection: 1,
        positionError: 100,
      },
    },
    {
      id: 3,
      productModel: "YZ_AXIS_HOIST_500KG",
      plcId: 14,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: "1.2",
      controlledObjectId: 8,
      axisKey: "0",
      params: {
        workingStroke: 253,
        maxAxisVelocity: 500,
        reductionRatio: 15,
        axisDirection: 1,
        positionError: 100,
      },
    },
    {
      id: 4,
      productModel: "YZ_AXIS_HOIST_500KG",
      plcId: 14,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: "2.1",
      controlledObjectId: 8,
      axisKey: "1",
      params: {
        workingStroke: 253,
        maxAxisVelocity: 500,
        reductionRatio: 15,
        axisDirection: 1,
        positionError: 100,
      },
    },
    {
      id: 5,
      productModel: "YZ_AXIS_HOIST_500KG",
      plcId: 1,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: "1.1",
      controlledObjectId: 9,
      axisKey: "0",
      params: {
        workingStroke: 253,
        maxAxisVelocity: 500,
        reductionRatio: 15,
        axisDirection: 1,
        positionError: 100,
      },
    },
    {
      id: 6,
      productModel: "YZ_AXIS_HOIST_500KG",
      plcId: 1,
      busNo: 0 as const,
      axisType: 0 as const,
      nodeAddress: "1.2",
      controlledObjectId: null,
      axisKey: null,
      params: {
        workingStroke: 253,
        maxAxisVelocity: 500,
        reductionRatio: 15,
        axisDirection: 1,
        positionError: 100,
      },
    },
  ],
  controlledObjects: [
    {
      id: 7,
      name: "升降灯架-01",
      controlType: 2 as const,
      enabledVirtualAxes: ["v1" as const],
      shapePreset: "cube" as const,
      shapeDimensions: { width: 2000, height: 400, depth: 1500 },
      dimensions: { w: 2000, h: 400, d: 1500 },
      position: { x: 0, y: 4000, z: 0 },
      centerOffset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: "#869398",
      pulleyDistance: 0,
      modelRunDirection: 1 as const,
      driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
      maxAxisVelocity: 200,
      motionParams: { move: { ...MOTION_DEFAULTS.move } },
      params: {},
    },
    {
      id: 8,
      name: "升降摆动架-01",
      controlType: 6 as const,
      enabledVirtualAxes: ["v1" as const, "v2" as const],
      shapePreset: "cube" as const,
      shapeDimensions: { width: 2000, height: 500, depth: 1200 },
      dimensions: { w: 2000, h: 500, d: 1200 },
      position: { x: 3000, y: 3000, z: 0 },
      centerOffset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: "#4ade80",
      pulleyDistance: 0,
      modelRunDirection: 1 as const,
      driveAxes: [
        { key: "0", mount: { x: -700, z: 0 } },
        { key: "1", mount: { x: 700, z: 0 } },
      ],
      maxAxisVelocity: 200,
      pDefaultMaxVelocity: 3,
      motionParams: {
        move: { ...MOTION_DEFAULTS.move },
        swingX: { ...MOTION_DEFAULTS.swingX },
      },
      params: {},
    },
    {
      id: 9,
      name: "飘摆架-01",
      controlType: 8 as const,
      enabledVirtualAxes: ["v1" as const, "v2" as const, "v3" as const],
      shapePreset: "ring" as const,
      shapeDimensions: { outerDiameter: 1200, innerDiameter: 720, thickness: 200 },
      dimensions: { w: 1200, h: 200, d: 1200 },
      position: { x: -2000, y: 5000, z: 1000 },
      centerOffset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: "#bac3ff",
      pulleyDistance: 0,
      modelRunDirection: 1 as const,
      driveAxes: [
        { key: "0", mount: { x: -400, z: -400 } },
        { key: "1", mount: { x: 400, z: -400 } },
        { key: "2", mount: { x: -400, z: 400 } },
        { key: "3", custom: true, mount: { x: 400, z: 400 } },
      ],
      maxAxisVelocity: 200,
      pDefaultMaxVelocity: 3,
      yDefaultMaxVelocity: 3,
      motionParams: {
        move: { ...MOTION_DEFAULTS.move },
        swingX: { ...MOTION_DEFAULTS.swingX },
        swingY: { ...MOTION_DEFAULTS.swingY },
      },
      params: {},
    },
  ],
  alignment: {
    "7": { method: "distance" as const, status: "aligned" as const, alignedAt: "2026-05-26T09:12:00Z" },
    "8": { method: null, status: "not_started" as const, alignedAt: null },
  },
};

const GZ_MOTION: ProjectMotion = {
  actionSequences: [],
  programs: [
    {
      id: "prog-gz-main",
      name: "2025广州演唱会",
      note: "主体 90 分钟",
      chapters: [
        {
          id: "ch-01",
          name: "第一章 开场",
          items: [],
        },
        {
          id: "ch-02",
          name: "第二章 高潮",
          items: [],
        },
      ],
    },
  ],
};

const GZ_META: ProjectMeta = {
  id: "gz-2025",
  name: "2025广州演唱会",
  createdAt: "2024-10-01T08:00:00Z",
  modifiedAt: "2026-05-01T14:32:00Z",
  author: "SysAdmin_01",
  status: "active",
  tags: ["24台设备", "就绪"],
  wizard: {
    currentStep: "review",
    completedSteps: ["objects", "hardware", "binding"],
    skippedSteps: [],
    simulationOnly: false,
    wizardCompleted: true,
  },
};

const buildSnapshotPayload = (): CurrentProjectSnapshotPayload => ({
  schemaVersion: PROJECT_SCHEMA_VERSION,
  meta: {
    ...GZ_META,
    modifiedAt: "2026-04-28T10:00:00Z",
    wizard: { ...GZ_META.wizard, completedSteps: [...GZ_META.wizard.completedSteps] },
  },
  setup: structuredClone(GZ_SETUP),
  motion: structuredClone(GZ_MOTION),
  rules: {
    rules: [
      { id: "r1", name: "升降互锁-A/B", enabled: true, note: "模板 T_INTERLOCK_RUN，图待实现" },
      { id: "r2", name: "最小位差保护", enabled: true },
    ],
  },
});

export const GZ_2025_DOCUMENT: ProjectDocument = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  meta: GZ_META,
  setup: GZ_SETUP,
  motion: GZ_MOTION,
  rules: {
    rules: [
      { id: "r1", name: "升降互锁-A/B", enabled: true, note: "模板 T_INTERLOCK_RUN，图待实现" },
      { id: "r2", name: "最小位差保护", enabled: true },
    ],
  },
  view: createDefaultSavedView(),
  snapshots: [
    {
      id: "snap-v240",
      label: "v2.4.0-stable",
      createdAt: "2026-05-01T12:00:00Z",
      author: "SysAdmin_01",
      note: "演出前冻结",
      payload: buildSnapshotPayload(),
    },
  ],
};
