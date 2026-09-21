// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { createDefaultAxisProfiles } from "@/app/project/action-sequence/motion-profile";
import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";
import type { DynamicPresetBlock } from "@/app/project/action-sequence/types";
import { PresetBlockFields } from "./preset-block-panel";

vi.mock("../use-action-builder", () => ({
  useActionBuilder: () => ({
    getTimelineObject: () => undefined,
    sequenceIssues: [],
  }),
}));

vi.mock("../motion-profile/motion-profile-editor", () => ({
  MotionProfileEditor: () => null,
}));

afterEach(() => {
  cleanup();
});

const waveBlock = (): DynamicPresetBlock => ({
  id: "wave-1",
  kind: "dynamic-preset",
  presetId: "dynamic-wave",
  startMs: 1000,
  endMs: 3000,
  orderedObjectIds: [7, 8],
  params: { baseV1: 1000, amplitude: 500, cycles: 1, direction: 1, staggerMs: 500 },
  profiles: createDefaultAxisProfiles(750),
});

it("shows stagger interval in seconds with one decimal", () => {
  const onReplaceBlock = vi.fn();
  const block = waveBlock();
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <PresetBlockFields
        block={block}
        resolved={resolveActionSequence({
          id: 1,
          name: "Seq",
          trajectoryMode: false,
          blocks: [block],
          segments: [],
        })}
        onReplaceBlock={onReplaceBlock}
      />
    </DisplayLengthUnitProvider>,
  );
  const stagger = screen.getByLabelText("错开间隔");
  expect(stagger.textContent).toContain("0.5");
  expect(stagger.textContent).toContain("s");
  fireEvent.mouseDown(within(stagger.closest(".group\\/value") ?? stagger.parentElement!).getByLabelText("增加"));
  expect(onReplaceBlock).toHaveBeenCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ staggerMs: 600 }),
    }),
  );
});
