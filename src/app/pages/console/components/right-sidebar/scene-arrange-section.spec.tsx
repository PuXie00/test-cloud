// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneArrangeSection } from "./scene-arrange-section";

const align = vi.fn();
const distribute = vi.fn();
const updateObjectsBatch = vi.fn();
const toastWarning = vi.fn();

vi.mock("sonner", () => ({
  toast: { warning: (...args: unknown[]) => toastWarning(...args) },
}));
vi.mock("@/app/pages/console/3d/Viz3DProvider", () => ({
  useViz3DContext: () => ({
    getSelection: () => ["1", "2", "3"],
    align,
    distribute,
  }),
}));
vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({ updateObject: vi.fn(), updateObjectsBatch }),
}));

const payload = {
  id: "2",
  position: { x: 1, y: 2, z: 3 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  align.mockReturnValue([]);
  distribute.mockReturnValue([]);
});

afterEach(() => cleanup());

describe("对齐与均布", () => {
  it("每个方向都写明含义，不再有向左向右和双向置中", () => {
    render(<SceneArrangeSection selectedCount={3} />);

    for (const name of ["X 左右中心对齐", "Y 高度顶部对齐", "Y 高度中心对齐", "Y 高度底部对齐", "Z 前后中心对齐"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const name of ["沿 X 左右均布", "沿 Y 高度均布", "沿 Z 前后均布"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /向左|向右|双向/ })).toBeNull();
  });

  it("每个按钮都有图标，Z 方向的图标转成斜线表示纵深", () => {
    render(<SceneArrangeSection selectedCount={3} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelector("svg")).toBeTruthy();
    }
    const iconOf = (name: string) =>
      screen.getByRole("button", { name }).querySelector("svg")!.getAttribute("class");
    expect(iconOf("Z 前后中心对齐")).toContain("-rotate-45");
    expect(iconOf("沿 Z 前后均布")).toContain("-rotate-45");
    expect(iconOf("X 左右中心对齐")).not.toContain("rotate");
    expect(iconOf("Y 高度顶部对齐")).not.toContain("rotate");
  });

  it("对齐按轴和边调用引擎，并写回工程", () => {
    align.mockReturnValue([payload]);
    render(<SceneArrangeSection selectedCount={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Y 高度顶部对齐" }));
    expect(align).toHaveBeenCalledWith(["1", "2", "3"], "y", "max");

    fireEvent.click(screen.getByRole("button", { name: "Y 高度底部对齐" }));
    expect(align).toHaveBeenCalledWith(["1", "2", "3"], "y", "min");

    fireEvent.click(screen.getByRole("button", { name: "Z 前后中心对齐" }));
    expect(align).toHaveBeenCalledWith(["1", "2", "3"], "z", "center");

    expect(updateObjectsBatch).toHaveBeenCalledTimes(3);
  });

  it("均布一次写回全部物体，算一步撤销", () => {
    distribute.mockReturnValue([payload, { ...payload, id: "3" }]);
    render(<SceneArrangeSection selectedCount={3} />);

    fireEvent.click(screen.getByRole("button", { name: "沿 Z 前后均布" }));

    expect(distribute).toHaveBeenCalledWith(["1", "2", "3"], "z");
    expect(updateObjectsBatch).toHaveBeenCalledTimes(1);
    expect(updateObjectsBatch.mock.calls[0]![0]).toHaveLength(2);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("均布后没有物体移动时说明原因，不写工程", () => {
    render(<SceneArrangeSection selectedCount={3} />);

    fireEvent.click(screen.getByRole("button", { name: "沿 X 左右均布" }));

    expect(updateObjectsBatch).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("只选 2 个时能对齐，均布不可用并直接写明原因", () => {
    render(<SceneArrangeSection selectedCount={2} />);

    expect((screen.getByRole("button", { name: "沿 X 左右均布" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "X 左右中心对齐" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("至少选 3 个物体才能均布。")).toBeTruthy();
  });
});
