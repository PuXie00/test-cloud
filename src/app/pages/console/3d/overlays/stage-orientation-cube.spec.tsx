// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellOrientation } from "@/app/viz3d";
import { StageOrientationCube } from "./stage-orientation-cube";

const fromFront: CellOrientation = {
  right: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  towardCamera: { x: 0, y: 0, z: 1 },
};

const fromStageRightFront: CellOrientation = {
  right: { x: -Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
  up: { x: 0, y: 1, z: 0 },
  towardCamera: { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
};

afterEach(cleanup);

describe("舞台方位立方体", () => {
  it("识别观众与演员左右，只对朝向镜头的面开放点击", () => {
    const select = vi.fn();
    render(<StageOrientationCube orientation={fromStageRightFront} onSelect={select} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "从台口看" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "从台右看" }), { key: "Enter" });
    expect(select.mock.calls).toEqual([["front"], ["side"]]);
  });

  it("正视单面时可以继续切往相邻的上下左右视角", () => {
    const select = vi.fn();
    render(<StageOrientationCube orientation={fromFront} onSelect={select} />);
    for (const name of ["从顶看", "从底看", "从台左看", "从台右看"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.queryByRole("button", { name: "从台后看" })).toBeNull();
    expect(select.mock.calls).toEqual([["top"], ["bottom"], ["left"], ["side"]]);
  });
});
