// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSequenceConfig } from "@/app/project/action-sequence/types";
import { ActionBuilderRightSidebar } from "./action-builder-right-sidebar";

const broken: ActionSequenceConfig = {
  id: 97,
  name: "Broken",
  trajectoryMode: "non-forced",
  blocks: [
    {
      id: "bad-preset",
      kind: "static-preset",
      presetId: "not-a-preset",
      atMs: 1000,
      orderedObjectIds: [7],
      params: { v1: 0, v2: 0, v3: 0 },
    },
  ],
  segments: [],
};

const { builderState } = vi.hoisted(() => ({
  builderState: { current: {} as Record<string, unknown> },
}));

vi.mock("./use-action-builder", () => ({
  useActionBuilder: () => builderState.current,
}));

vi.mock("@/app/project/display-length-unit-provider", () => ({
  useSessionDisplayLengthUnit: () => "mm" as const,
}));

const mockBuilder = (overrides: Record<string, unknown> = {}) => {
  builderState.current = {
    activeRightTab: "selection",
    setActiveRightTab: vi.fn(),
    sequence: broken,
    dockMode: "sequence",
    selection: { kind: "block", blockId: "bad-preset" },
    selectedObjectIds: [],
    cues: [],
    selectedCueId: null,
    sequenceMissingHint: false,
    handleReplaceTimelineBlock: vi.fn(),
    handleUpdateSegmentSettings: vi.fn(),
    handleBlockDelete: vi.fn(),
    handleTrajectoryModeChange: vi.fn(),
    handleCreatePose: vi.fn(),
    handleCreateSetEnabled: vi.fn(),
    handleCreateCue: vi.fn(),
    handleCreateSequence: vi.fn(),
    handleApplyStaticPreset: vi.fn(),
    handleApplyDynamicPreset: vi.fn(),
    handleCueAddObjects: vi.fn(),
    ...overrides,
  };
};

afterEach(() => {
  cleanup();
});

describe("action builder right sidebar", () => {
  beforeEach(() => {
    mockBuilder();
  });

  it("does not throw when rendering a sequence with an unknown preset", () => {
    expect(() => render(<ActionBuilderRightSidebar />)).not.toThrow();
    expect(screen.getByRole("button", { name: "删除" })).not.toBeNull();
  });

  it("does not show a trajectory switch in the right panel when nothing is selected", () => {
    mockBuilder({
      sequence: {
        id: 1,
        name: "Seq",
        trajectoryMode: "non-forced",
        blocks: [],
        segments: [],
      },
      selection: null,
    });
    render(<ActionBuilderRightSidebar />);
    expect(screen.queryByRole("switch", { name: "强制轨迹" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "动作序列" })).toBeNull();
  });
});
