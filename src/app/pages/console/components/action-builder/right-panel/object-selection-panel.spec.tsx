// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectSelectionPanel } from "./object-selection-panel";

const onCreatePose = vi.fn();
const onCreateSetEnabled = vi.fn();
const onCreateCue = vi.fn();
const onCreateSequence = vi.fn();
const onApplyStaticPreset = vi.fn();
const onApplyDynamicPreset = vi.fn();
const onAddToCurrentCue = vi.fn();

type RenderOptions = {
  mode?: "cue" | "sequence" | "empty";
  cueObjectIds?: number[];
};

const renderPanel = (selectedObjectIds: number[], options: RenderOptions = {}) =>
  render(
    <ObjectSelectionPanel
      mode={options.mode ?? "sequence"}
      selectedObjectIds={selectedObjectIds}
      cueObjectIds={options.cueObjectIds}
      onCreatePose={onCreatePose}
      onCreateSetEnabled={onCreateSetEnabled}
      onCreateCue={onCreateCue}
      onCreateSequence={onCreateSequence}
      onApplyStaticPreset={onApplyStaticPreset}
      onApplyDynamicPreset={onApplyDynamicPreset}
      onAddToCurrentCue={onAddToCurrentCue}
    />,
  );

afterEach(() => {
  cleanup();
  onCreatePose.mockClear();
  onCreateSetEnabled.mockClear();
  onCreateCue.mockClear();
  onCreateSequence.mockClear();
  onApplyStaticPreset.mockClear();
  onApplyDynamicPreset.mockClear();
  onAddToCurrentCue.mockClear();
});

describe("object selection creation", () => {
  it("creates only pose and command items for one selected model", () => {
    renderPanel([7]);
    expect(screen.getByRole("button", { name: "添加位姿" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "使能" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "断使能" })).not.toBeNull();
    expect(screen.queryByText("目标值块")).toBeNull();
    expect(screen.queryByText("摆动块")).toBeNull();
    expect(screen.queryByText("旋转块")).toBeNull();
    expect(screen.queryByText("保持块")).toBeNull();
    expect(screen.queryByRole("button", { name: /静态预设/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /动态预设/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加位姿" }));
    expect(onCreatePose).toHaveBeenCalledWith([7]);
    fireEvent.click(screen.getByRole("button", { name: "使能" }));
    expect(onCreateSetEnabled).toHaveBeenCalledWith([7], true);
    fireEvent.click(screen.getByRole("button", { name: "断使能" }));
    expect(onCreateSetEnabled).toHaveBeenCalledWith([7], false);
  });

  it("creates parameterized preset blocks for multiple models", () => {
    renderPanel([7, 8]);
    expect(screen.queryByText("目标值块")).toBeNull();
    expect(screen.queryByText("保存为 Cue")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加位姿" }));
    expect(onCreatePose).toHaveBeenCalledWith([7, 8]);
    fireEvent.click(screen.getByRole("button", { name: "使能" }));
    expect(onCreateSetEnabled).toHaveBeenCalledWith([7, 8], true);
    fireEvent.click(screen.getByRole("button", { name: "断使能" }));
    expect(onCreateSetEnabled).toHaveBeenCalledWith([7, 8], false);
    fireEvent.click(screen.getByRole("button", { name: /静态预设.*斜面/ }));
    expect(onApplyStaticPreset).toHaveBeenCalledWith(
      "static-slope",
      [7, 8],
      expect.objectContaining({ amplitude: expect.any(Number), phase: expect.any(Number) }),
    );
    expect(onCreateCue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /动态预设.*水平升降/ }));
    expect(onApplyDynamicPreset).toHaveBeenCalledWith("dynamic-level", [7, 8]);
    expect(onCreateSequence).not.toHaveBeenCalled();
  });

  it("adds 3D multi-selection to the current cue without pose or presets", () => {
    renderPanel([7, 8], { mode: "cue", cueObjectIds: [7] });
    expect(screen.queryByRole("button", { name: "添加位姿" })).toBeNull();
    expect(screen.queryByRole("button", { name: "使能" })).toBeNull();
    expect(screen.queryByRole("button", { name: "断使能" })).toBeNull();
    expect(screen.queryByRole("button", { name: /静态预设/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /动态预设/ })).toBeNull();
    expect(screen.getByRole("button", { name: "新建 Cue" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "新建动作序列" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加入当前 Cue" }));
    expect(onAddToCurrentCue).toHaveBeenCalledWith([8]);
  });

  it("disables add-to-cue when every selected object is already in the cue", () => {
    renderPanel([7], { mode: "cue", cueObjectIds: [7] });
    expect(screen.getByRole("button", { name: "加入当前 Cue" })).toHaveProperty("disabled", true);
  });

  it("shows only create actions when no cue or sequence is open", () => {
    renderPanel([7, 8], { mode: "empty" });
    expect(screen.queryByRole("button", { name: "添加位姿" })).toBeNull();
    expect(screen.queryByRole("button", { name: "加入当前 Cue" })).toBeNull();
    expect(screen.queryByRole("button", { name: /静态预设/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建 Cue" }));
    expect(onCreateCue).toHaveBeenCalledWith([7, 8]);
    fireEvent.click(screen.getByRole("button", { name: "新建动作序列" }));
    expect(onCreateSequence).toHaveBeenCalledWith([7, 8]);
  });
});
