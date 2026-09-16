// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_DEFAULTS } from "@/app/project/configuration-rules";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import type { ControlledObjectConfig, ProjectDocument } from "@/app/project/project-document-types";
import { createEmptyDocument } from "@/app/project/project-document-empty";
import { SequencePreviewProvider, useSequencePreview } from "./sequence-preview-provider";

const OBJECT_ID = 1;

const { navState, projectState, toastWarning, clock } = vi.hoisted(() => ({
  navState: { current: { activeNav: "control" as string } },
  projectState: {
    current: {
      currentProject: null as { id: string; document: ProjectDocument } | null,
    },
  },
  toastWarning: vi.fn(),
  clock: { now: 0 },
}));

vi.mock("./use-console-nav", () => ({
  useConsoleNav: () => navState.current,
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: projectState.current.currentProject,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

const makeObject = (id: number): ControlledObjectConfig => ({
  id,
  name: `Obj${id}`,
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
  driveAxes: [{ key: "0", mount: { x: 0, z: 0 } }],
  maxAxisVelocity: 200,
  motionParams: { move: { ...MOTION_DEFAULTS.move } },
  params: {},
});

const validSequence = (id: number, atMs = 1000): ActionSequenceConfig => ({
  id,
  name: `Seq${id}`,
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: `pose-${id}`,
      kind: "pose",
      objectId: OBJECT_ID,
      atMs,
      pose: { v1: 80, v2: 0, v3: 0 },
    },
  ],
  segments: [],
});

const emptySequence = (id: number): ActionSequenceConfig => ({
  id,
  name: `Empty${id}`,
  trajectoryMode: "non-forced",
  blocks: [],
  segments: [],
});

const makeProject = () => {
  const document = createEmptyDocument({ id: "p", name: "P", author: "tester" });
  document.setup.controlledObjects = [makeObject(OBJECT_ID)];
  document.motion.actionSequences = [validSequence(1), emptySequence(2), validSequence(3, 2000)];
  return { id: document.meta.id, document };
};

const advanceFrames = (count: number) => {
  for (let i = 0; i < count; i += 1) {
    act(() => {
      clock.now += 16;
      vi.advanceTimersByTime(16);
    });
  }
};

beforeEach(() => {
  navState.current.activeNav = "control";
  projectState.current.currentProject = makeProject();
  toastWarning.mockClear();
  clock.now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(clock.now), 16) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  navState.current.activeNav = "control";
  projectState.current.currentProject = makeProject();
  toastWarning.mockClear();
});

describe("SequencePreviewProvider", () => {
  it("toggle enters preview and toggling the same id exits", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });

    act(() => {
      result.current.togglePreview(1, { faderPercent: 40 });
    });

    expect(result.current.sequenceId).toBe(1);
    expect(result.current.cursorMs).toBe(0);
    expect(result.current.totalMs).toBe(1000);
    expect(result.current.faderPercent).toBe(40);

    act(() => {
      result.current.togglePreview(1);
    });

    expect(result.current.sequenceId).toBeNull();
  });

  it("toggling a different id switches sequenceId", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });

    act(() => {
      result.current.togglePreview(1);
    });
    expect(result.current.sequenceId).toBe(1);

    act(() => {
      result.current.togglePreview(3);
    });
    expect(result.current.sequenceId).toBe(3);
    expect(result.current.totalMs).toBe(2000);
  });

  it("hold-mode autoplay advances the cursor and stopPreview resets", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });

    act(() => {
      result.current.startPreview(1, { autoplay: true, holdMode: true });
    });
    expect(result.current.sequenceId).toBe(1);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.holdMode).toBe(true);

    advanceFrames(8);
    expect(result.current.cursorMs).toBeGreaterThan(0);

    act(() => {
      result.current.stopPreview();
    });
    expect(result.current.sequenceId).toBeNull();
    expect(result.current.cursorMs).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });

  it("setMultiplier(4) advances about 4× faster than 1× for the same dt", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });
    const ticks = 8;

    act(() => {
      result.current.startPreview(1, { autoplay: true });
    });
    advanceFrames(ticks);
    const slow = result.current.cursorMs;
    expect(slow).toBeGreaterThan(0);

    act(() => {
      result.current.stopPreview();
    });

    act(() => {
      result.current.startPreview(1, { autoplay: true });
      result.current.setMultiplier(4);
    });
    advanceFrames(ticks);
    const fast = result.current.cursorMs;

    expect(fast / slow).toBeCloseTo(4, 1);
  });

  it("play at the end rewinds to 0 then plays", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });

    act(() => {
      result.current.startPreview(1);
    });
    act(() => {
      result.current.setCursorMs(result.current.totalMs);
    });
    expect(result.current.cursorMs).toBe(1000);
    expect(result.current.isPlaying).toBe(false);

    act(() => {
      result.current.play();
    });

    expect(result.current.cursorMs).toBe(0);
    expect(result.current.isPlaying).toBe(true);
  });

  it("invalid empty-blocks sequence toasts and does not start", () => {
    const { result } = renderHook(() => useSequencePreview(), { wrapper: SequencePreviewProvider });

    act(() => {
      result.current.startPreview(2);
    });

    expect(toastWarning).toHaveBeenCalled();
    expect(result.current.sequenceId).toBeNull();
  });

  it("stops preview when nav leaves control", () => {
    const { result, rerender } = renderHook(() => useSequencePreview(), {
      wrapper: SequencePreviewProvider,
    });

    act(() => {
      result.current.togglePreview(1);
    });
    expect(result.current.sequenceId).toBe(1);

    navState.current.activeNav = "sequences";
    rerender();

    expect(result.current.sequenceId).toBeNull();
  });
});
