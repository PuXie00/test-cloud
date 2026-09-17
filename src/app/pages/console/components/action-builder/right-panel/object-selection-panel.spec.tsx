// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectSelectionPanel } from "./object-selection-panel";

const onCreatePose = vi.fn();
const onCreateSetEnabled = vi.fn();
const onCreateSequence = vi.fn();
const onApplyStaticPreset = vi.fn();
const onApplyDynamicPreset = vi.fn();

type RenderOptions = {
  mode?: "sequence" | "empty";
};

const renderPanel = (selectedObjectIds: number[], options: RenderOptions = {}) =>
  render(
    <ObjectSelectionPanel
      mode={options.mode ?? "sequence"}
      selectedObjectIds={selectedObjectIds}
      onCreatePose={onCreatePose}
      onCreateSetEnabled={onCreateSetEnabled}
      onCreateSequence={onCreateSequence}
      onApplyStaticPreset={onApplyStaticPreset}
      onApplyDynamicPreset={onApplyDynamicPreset}
    />,
  );

afterEach(() => {
  cleanup();
  onCreatePose.mockClear();
  onCreateSetEnabled.mockClear();
  onCreateSequence.mockClear();
  onApplyStaticPreset.mockClear();
  onApplyDynamicPreset.mockClear();
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
    expect(onApplyStaticPreset).toHaveBeenCalledWith("static-slope", [7, 8]);
    fireEvent.click(screen.getByRole("button", { name: /动态预设.*水平升降/ }));
    expect(onApplyDynamicPreset).toHaveBeenCalledWith("dynamic-level", [7, 8]);
    expect(onCreateSequence).not.toHaveBeenCalled();
  });

  it("has 新建动作序列 and not 新建 Cue", () => {
    renderPanel([7], { mode: "empty" });
    expect(screen.queryByRole("button", { name: "新建 Cue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "加入当前 Cue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建动作序列" }));
    expect(onCreateSequence).toHaveBeenCalledWith([7]);
  });
});
