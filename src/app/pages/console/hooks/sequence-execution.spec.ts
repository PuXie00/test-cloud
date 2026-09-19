import { afterEach, describe, expect, it, vi } from "vitest";
import { compilePlcAction } from "@/app/project/action-sequence/compile-plc-action";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { toActionDataSaveItems } from "@/app/project/action-sequence/plc-action-payload";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import type { ControlledObjectConfig, ProjectDocument } from "@/app/project/project-document-types";
import {
  createCsocketSequenceTransport,
  createLocalSequenceTransport,
  downloadSequence,
  LOCAL_SEQUENCE_SYNC_GROUP_ID,
  getSequenceTransport,
  goSequence,
  mapFaderPercentToSpeedScale,
  readySequence,
  sequenceReadyFingerprint,
  startLocalAuthoredSequence,
  stopSequence,
  type SequenceExecutionTransport,
} from "./sequence-execution";

const completeLimits = {
  v1: {
    min: -10_000,
    max: 10_000,
    maxVelocity: 10_000,
    minAccelTime: 0.2,
  },
};

const context = {
  objects: [{ id: 7, enabledVirtualAxes: ["v1"] as const, limits: completeLimits }],
};

const validSequence: ActionSequenceConfig = {
  id: 1,
  name: "Seq",
  trajectoryMode: "forced",
  blocks: [
    {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: 1000,
      pose: { v1: 500, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

const invalidSequence: ActionSequenceConfig = {
  ...validSequence,
  blocks: [
    {
      id: "pose",
      kind: "pose",
      objectId: 7,
      atMs: -1,
      pose: { v1: 500, v2: 0, v3: 0 },
    },
  ],
};

const commandOnlySequence: ActionSequenceConfig = {
  id: 3,
  name: "Cmd",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "enable",
      kind: "instruction",
      presetId: "set-enabled",
      objectId: 7,
      atMs: 1000,
      instr: { enabled: true },
    },
  ],
  segments: [],
};

type InstrumentedTransport = SequenceExecutionTransport & {
  calls: string[];
  saveAction: ReturnType<typeof vi.fn>;
  syncCall: ReturnType<typeof vi.fn>;
  stopAction: ReturnType<typeof vi.fn>;
};

const createTransport = (): InstrumentedTransport => {
  const calls: string[] = [];
  return {
    calls,
    saveAction: vi.fn(async () => {
      calls.push("save");
    }),
    syncCall: vi.fn(async () => {
      calls.push("sync");
    }),
    stopAction: vi.fn().mockResolvedValue(undefined),
  };
};

const createMockCsocketApi = (saveResult: unknown) => ({
  actionReady: vi.fn().mockResolvedValue(saveResult),
  actionGo: vi.fn().mockResolvedValue({ success: true, data: [] }),
  stopActionPlc: vi.fn().mockResolvedValue({ success: true, data: [] }),
});

const fixtureObject = (): ControlledObjectConfig => ({
  id: 7,
  name: "O7",
  controlType: 2,
  enabledVirtualAxes: ["v1"],
  shapePreset: "cube",
  shapeDimensions: { width: 1000, height: 1000, depth: 1000 },
  dimensions: { w: 1000, h: 1000, d: 1000 },
  position: { x: 0, y: 0, z: 0 },
  centerOffset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  color: "#869398",
  pulleyDistance: 0,
  modelRunDirection: 1,
  driveAxes: [{ key: "0" }],
  maxAxisVelocity: 200,
  motionParams: {},
  params: {},
});

const documentWithSequence = (sequence: ActionSequenceConfig): ProjectDocument => {
  const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
  document.setup.controlledObjects = [fixtureObject()];
  document.motion.actionSequences = [sequence];
  return document;
};

describe("downloadSequence", () => {
  it("refuses download when validation has blocking errors", async () => {
    const transport: SequenceExecutionTransport = {
      saveAction: vi.fn(),
      syncCall: vi.fn(),
      stopAction: vi.fn(),
    };
    const result = await downloadSequence(invalidSequence, context, transport);
    expect(result).toEqual({ ok: false, reason: "validation", issues: expect.any(Array) });
    expect(transport.saveAction).not.toHaveBeenCalled();
  });

  it("passes compiled save items with actionId and no actionNo", async () => {
    const transport = createTransport();
    const downloaded = await downloadSequence(validSequence, context, transport);
    const expected = toActionDataSaveItems(
      compilePlcAction(validSequence, context),
      validSequence.id,
    );
    expect(transport.saveAction).toHaveBeenCalledWith(expected);
    expect(downloaded).toEqual({
      ok: true,
      actionId: validSequence.id,
      sequenceId: validSequence.id,
      modelIds: expect.any(Array),
    });
    expect(expected[0]).not.toHaveProperty("actionNo");
    expect(expected[0]?.actionId).toBe(validSequence.id);
  });

  it("collects command-only model IDs from events and reaches saveAction", async () => {
    const transport = createTransport();
    const downloaded = await downloadSequence(commandOnlySequence, context, transport);
    expect(downloaded).toMatchObject({ ok: true, modelIds: [7] });
    expect(transport.saveAction).toHaveBeenCalled();
    const compiled = compilePlcAction(commandOnlySequence, context);
    expect(compiled.timelines).toEqual([]);
    expect(compiled.events.map((event) => event.modelId)).toEqual([7]);
  });

  it("forwards complete axis limits so a moving sequence can compile", async () => {
    const transport = createTransport();
    const moving: ActionSequenceConfig = {
      ...validSequence,
      blocks: [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: { v1: 0, v2: 0, v3: 0 } },
        { id: "end", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 100, v2: 0, v3: 0 } },
      ],
      segments: [{
        fromRef: "start",
        toRef: "end",
        settings: {
          profiles: createDefaultAxisProfiles(1000),
        },
      }],
    };
    const downloaded = await downloadSequence(moving, context, transport);
    expect(downloaded.ok).toBe(true);
    expect(transport.saveAction).toHaveBeenCalled();
  });
});

describe("readySequence", () => {
  it("saves without syncing and returns a content fingerprint", async () => {
    const transport = createTransport();
    const readied = await readySequence({
      document: documentWithSequence(validSequence),
      sequenceId: validSequence.id,
      transport,
    });

    expect(transport.calls).toEqual(["save"]);
    expect(transport.syncCall).not.toHaveBeenCalled();
    expect(readied).toEqual({
      ok: true,
      name: "Seq",
      sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
      fingerprint: sequenceReadyFingerprint(validSequence),
    });
  });

  it("does not save when download validation fails", async () => {
    const transport = createTransport();
    const readied = await readySequence({
      document: documentWithSequence(invalidSequence),
      sequenceId: invalidSequence.id,
      transport,
    });
    expect(readied.ok).toBe(false);
    expect(transport.saveAction).not.toHaveBeenCalled();
    expect(transport.syncCall).not.toHaveBeenCalled();
  });

  it("saves through window.csocketApi when no transport is passed", async () => {
    const api = createMockCsocketApi({ success: true, data: [{ actionId: validSequence.id }] });
    vi.stubGlobal("window", { csocketApi: api });
    try {
      const readied = await readySequence({
        document: documentWithSequence(validSequence),
        sequenceId: validSequence.id,
      });
      expect(readied.ok).toBe(true);
      expect(api.actionReady).toHaveBeenCalledTimes(1);
      expect(api.actionGo).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("simulates Ready success when saveAction throws", async () => {
    const transport = createTransport();
    transport.saveAction.mockRejectedValueOnce(new Error("PLC disconnected"));
    const readied = await readySequence({
      document: documentWithSequence(validSequence),
      sequenceId: validSequence.id,
      transport,
    });
    expect(readied).toEqual({
      ok: true,
      name: "Seq",
      sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
      fingerprint: sequenceReadyFingerprint(validSequence),
    });
  });

  it("simulates Ready success when csocket save fails", async () => {
    const api = createMockCsocketApi({
      ok: false,
      code: "PLC_DOWN",
      message: "csocket actionDataSave failed",
    });
    vi.stubGlobal("window", { csocketApi: api });
    try {
      const readied = await readySequence({
        document: documentWithSequence(validSequence),
        sequenceId: validSequence.id,
      });
      expect(readied).toEqual({
        ok: true,
        name: "Seq",
        sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
        fingerprint: sequenceReadyFingerprint(validSequence),
      });
      expect(api.actionReady).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("goSequence", () => {
  it("syncs without saving and uses the fader speedScale", async () => {
    const transport = createTransport();
    const started = await goSequence({
      document: documentWithSequence(validSequence),
      sequenceId: validSequence.id,
      faderPercent: 150,
      transport,
    });

    expect(transport.calls).toEqual(["sync"]);
    expect(transport.saveAction).not.toHaveBeenCalled();
    expect(transport.syncCall).toHaveBeenCalledWith({
      actionId: validSequence.id,
      syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
      startTimestamp: expect.any(Number),
      speedScale: 1.5,
      trajectoryMode: "forced",
    });
    expect(started).toEqual({
      ok: true,
      name: "Seq",
      speedPercent: 150,
      sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
    });
  });

  it("simulates GO success when syncCall throws", async () => {
    const transport = createTransport();
    transport.syncCall.mockRejectedValueOnce(new Error("PLC disconnected"));
    const started = await goSequence({
      document: documentWithSequence(validSequence),
      sequenceId: validSequence.id,
      faderPercent: 80,
      transport,
    });
    expect(started).toEqual({
      ok: true,
      name: "Seq",
      speedPercent: 80,
      sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
    });
  });

  it("simulates GO success when csocket sync fails", async () => {
    const api = createMockCsocketApi({ success: false, message: "actionGo success=false" });
    vi.stubGlobal("window", { csocketApi: api });
    try {
      const started = await goSequence({
        document: documentWithSequence(validSequence),
        sequenceId: validSequence.id,
        faderPercent: 100,
      });
      expect(started).toEqual({
        ok: true,
        name: "Seq",
        speedPercent: 100,
        sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
      });
      expect(api.actionGo).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("startLocalAuthoredSequence", () => {
  it("saves then syncs without prepare and passes semantic trajectoryMode", async () => {
    const transport = createTransport();
    const started = await startLocalAuthoredSequence({
      document: documentWithSequence(validSequence),
      sequenceId: validSequence.id,
      transport,
    });

    expect(transport.calls).toEqual(["save", "sync"]);
    expect(transport.syncCall).toHaveBeenCalledWith({
      actionId: validSequence.id,
      syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID,
      startTimestamp: expect.any(Number),
      speedScale: 1,
      trajectoryMode: "forced",
    });
    expect(started).toEqual({
      ok: true,
      name: "Seq",
      speedPercent: 100,
      sequenceHandle: { actionId: validSequence.id, syncGroupId: LOCAL_SEQUENCE_SYNC_GROUP_ID },
    });
    expect(started).not.toHaveProperty("durationMs");
  });

  it("does not sync when download validation fails", async () => {
    const transport = createTransport();
    const started = await startLocalAuthoredSequence({
      document: documentWithSequence(invalidSequence),
      sequenceId: invalidSequence.id,
      transport,
    });
    expect(started.ok).toBe(false);
    expect(transport.saveAction).not.toHaveBeenCalled();
    expect(transport.syncCall).not.toHaveBeenCalled();
    expect(transport.calls).toEqual([]);
  });
});

describe("stopSequence", () => {
  it("calls stopAction with actionId and syncGroupId and does not call syncCall", async () => {
    const transport = createTransport();
    await stopSequence({ actionId: 12, syncGroupId: 3 }, transport);
    expect(transport.stopAction).toHaveBeenCalledWith({ actionId: 12, syncGroupId: 3 });
    expect(transport.syncCall).not.toHaveBeenCalled();
  });
});

describe("mapFaderPercentToSpeedScale", () => {
  it("maps percent/100 and clamps to [0, 2]", () => {
    expect(mapFaderPercentToSpeedScale(0)).toBe(0);
    expect(mapFaderPercentToSpeedScale(100)).toBe(1);
    expect(mapFaderPercentToSpeedScale(200)).toBe(2);
    expect(mapFaderPercentToSpeedScale(-40)).toBe(0);
    expect(mapFaderPercentToSpeedScale(350)).toBe(2);
  });
});

describe("createLocalSequenceTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not touch window.csocketApi", async () => {
    const actionReady = vi.fn();
    vi.stubGlobal("window", { csocketApi: { actionReady } });
    const transport = createLocalSequenceTransport();
    await expect(transport.saveAction([])).resolves.toBeUndefined();
    expect(actionReady).not.toHaveBeenCalled();
    await expect(
      transport.syncCall({
        actionId: 1,
        syncGroupId: 1,
        startTimestamp: 1,
        speedScale: 1,
        trajectoryMode: "non-forced",
      }),
    ).resolves.toBeUndefined();
    await expect(transport.stopAction({ actionId: 1, syncGroupId: 1 })).resolves.toBeUndefined();
    expect(actionReady).not.toHaveBeenCalled();
  });
});

describe("getSequenceTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses actionReady when window.csocketApi is present", async () => {
    const api = createMockCsocketApi({ success: true, data: [{ actionId: 1 }] });
    vi.stubGlobal("window", { csocketApi: api });
    await getSequenceTransport().saveAction([]);
    expect(api.actionReady).toHaveBeenCalledTimes(1);
  });

  it("falls back to the local transport when csocketApi is missing", async () => {
    vi.stubGlobal("window", {});
    await expect(getSequenceTransport().saveAction([])).resolves.toBeUndefined();
  });
});

describe("createCsocketSequenceTransport", () => {
  it("saveAction accepts success with missing errorCount and rejects errorCount > 0", async () => {
    const ok = createMockCsocketApi({ success: true, data: [{ actionId: 1 }] });
    await expect(createCsocketSequenceTransport(ok).saveAction([])).resolves.toBeUndefined();

    const withErrors = createMockCsocketApi({
      success: true,
      data: [{ actionId: 1, errorCount: 2, errorCode: [1, 2] }],
    });
    await expect(createCsocketSequenceTransport(withErrors).saveAction([])).rejects.toThrow(
      /errorCount|errorCode/i,
    );
  });

  it("throws for CsocketResult { ok: false } and success: false", async () => {
    const failedWrap = createMockCsocketApi({
      ok: false,
      code: "E",
      message: "csocket actionDataSave failed",
    });
    await expect(createCsocketSequenceTransport(failedWrap).saveAction([])).rejects.toThrow(
      /actionDataSave|csocket/i,
    );

    const failedAck = createMockCsocketApi({ success: false, message: "actionDataSave success=false" });
    await expect(createCsocketSequenceTransport(failedAck).saveAction([])).rejects.toThrow(
      /success|actionDataSave/i,
    );
  });

  it("maps sync and stop onto actionGo/stopActionPlc and voids trajectoryMode at the adapter", async () => {
    const api = createMockCsocketApi({ success: true, data: [{ actionId: 9 }] });
    const transport = createCsocketSequenceTransport(api);
    await transport.syncCall({
      actionId: 9,
      syncGroupId: 4,
      startTimestamp: 99,
      speedScale: 1.5,
      trajectoryMode: "forced",
    });
    expect(api.actionGo).toHaveBeenCalled();
    const wireItem = api.actionGo.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    expect(wireItem).toEqual({
      actionId: 9,
      runDirection: 0,
      speedScale: 1.5,
      loopCount: 1,
    });
    expect(wireItem).not.toHaveProperty("trajectoryMode");
    await transport.stopAction({ actionId: 9, syncGroupId: 4 });
    expect(api.stopActionPlc.mock.calls[0]?.[0]).toEqual([{ deviceId: 9 }]);
  });
});
