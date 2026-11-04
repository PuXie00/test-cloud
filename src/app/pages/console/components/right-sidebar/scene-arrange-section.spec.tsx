// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneArrangeSection } from "./scene-arrange-section";

const align = vi.fn();
const distribute = vi.fn();
const updateObjectsBatch = vi.fn();
const toastWarning = vi.fn();
let directions = { x: 180, z: 225 };
let directionListener: ((next: { x: number; z: number }) => void) | null = null;

vi.mock("sonner", () => ({
  toast: { warning: (...args: unknown[]) => toastWarning(...args) },
}));
const engine = {
  getSelection: () => ["1", "2", "3"],
  getAxisScreenDirections: () => directions,
  events: {
    on: (_event: string, listener: typeof directionListener) => {
      directionListener = listener;
    },
    off: () => {
      directionListener = null;
    },
  },
  align,
  distribute,
};

vi.mock("@/app/pages/console/3d/Viz3DProvider", () => ({
  useViz3DContext: () => engine,
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
  it("每个方向都写明含义，X、Z 的边缘叫最小 / 最大，不叫会随视角变的向左向右", () => {
    render(<SceneArrangeSection selectedCount={3} />);

    for (const name of [
      "X 左右最小对齐",
      "X 左右中心对齐",
      "X 左右最大对齐",
      "Y 高度顶部对齐",
      "Y 高度中心对齐",
      "Y 高度底部对齐",
      "Z 前后最小对齐",
      "Z 前后中心对齐",
      "Z 前后最大对齐",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    for (const name of ["沿 X 左右均布", "沿 Y 高度均布", "沿 Z 前后均布"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /向左|向右|双向/ })).toBeNull();
  });

  it("每个按钮都有图标，X、Z 的图标指向该方向在当前视图里的真实走向", () => {
    // 前视图：+X 在屏幕左边（180°），+Z 朝镜头（按斜线画在左下，225°）
    directions = { x: 180, z: 225 };
    render(<SceneArrangeSection selectedCount={3} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelector("svg")).toBeTruthy();
    }
    const transformOf = (name: string) =>
      (screen.getByRole("button", { name }).querySelector("svg") as SVGElement).style.transform;
    expect(transformOf("X 左右最大对齐")).toBe("rotate(-180deg)");
    expect(transformOf("X 左右最小对齐")).toBe("rotate(-180deg)");
    expect(transformOf("Z 前后最大对齐")).toBe("rotate(-225deg)");
    expect(transformOf("沿 Z 前后均布")).toBe("rotate(-225deg)");
    expect(transformOf("Y 高度顶部对齐")).toBe("");
  });

  it("用常见的对齐图标：对齐线在哪一侧就向哪一侧对齐", () => {
    render(<SceneArrangeSection selectedCount={3} />);
    const iconClassOf = (name: string) =>
      screen.getByRole("button", { name }).querySelector("svg")!.getAttribute("class") ?? "";

    expect(iconClassOf("X 左右最小对齐")).toContain("lucide-align-start-vertical");
    expect(iconClassOf("X 左右中心对齐")).toContain("lucide-align-center-vertical");
    expect(iconClassOf("Z 前后最大对齐")).toContain("lucide-align-end-vertical");
    expect(iconClassOf("Y 高度顶部对齐")).toContain("lucide-align-start-horizontal");
    expect(iconClassOf("Y 高度底部对齐")).toContain("lucide-align-end-horizontal");
    expect(iconClassOf("沿 X 左右均布")).toContain("lucide-align-horizontal-distribute-center");
    expect(iconClassOf("沿 Y 高度均布")).toContain("lucide-align-vertical-distribute-center");
  });

  it("视角转动跨过档位时，图标跟着转", () => {
    directions = { x: 180, z: 225 };
    render(<SceneArrangeSection selectedCount={3} />);

    // 顶视图：+X 仍朝左，+Z 朝屏幕下方（270°）
    act(() => directionListener?.({ x: 0, z: 270 }));

    const transformOf = (name: string) =>
      (screen.getByRole("button", { name }).querySelector("svg") as SVGElement).style.transform;
    expect(transformOf("X 左右最大对齐")).toBe("");
    expect(transformOf("Z 前后最大对齐")).toBe("rotate(-270deg)");
  });

  it("卸载时取消订阅视角变化", () => {
    const view = render(<SceneArrangeSection selectedCount={3} />);
    expect(directionListener).not.toBeNull();
    view.unmount();
    expect(directionListener).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "X 左右最小对齐" }));
    expect(align).toHaveBeenCalledWith(["1", "2", "3"], "x", "min");

    fireEvent.click(screen.getByRole("button", { name: "Z 前后最大对齐" }));
    expect(align).toHaveBeenCalledWith(["1", "2", "3"], "z", "max");

    expect(updateObjectsBatch).toHaveBeenCalledTimes(5);
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
