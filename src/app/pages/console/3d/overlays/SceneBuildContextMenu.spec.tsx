// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuTrigger } from "@/app/components/ui/dropdown-menu";
import { SceneBuildContextMenuContent } from "./SceneBuildContextMenu";

const align = vi.fn();
const distribute = vi.fn();
const updateObjectsBatch = vi.fn();
let selection: string[] = [];

const engine = {
  getMode: () => "select",
  getSelection: () => selection,
  getAxisScreenDirections: () => ({ x: 180, z: 225 }),
  events: { on: vi.fn(), off: vi.fn() },
  align,
  distribute,
};

vi.mock("../Viz3DProvider", () => ({
  useViz3DContext: () => engine,
}));
vi.mock("../../hooks/use-project-store", () => ({
  useProjectStore: () => ({
    objects: [],
    mountObjects: vi.fn(),
    updateObject: vi.fn(),
    updateObjectsBatch,
  }),
}));

const renderMenu = () =>
  render(
    <DropdownMenu open>
      <DropdownMenuTrigger />
      <SceneBuildContextMenuContent
        copySelection={vi.fn()}
        pasteClipboard={vi.fn()}
        requestDeleteSelection={vi.fn()}
        canCopy
        canPaste
        canDelete
        contextObjectId={null}
      />
    </DropdownMenu>,
  );

const openSub = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name }));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  align.mockReturnValue([]);
  distribute.mockReturnValue([]);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("右键菜单的对齐与均布", () => {
  it("对齐项写明方向，不再有向左向右和双向置中", async () => {
    selection = ["1", "2"];
    renderMenu();
    await openSub(/^对齐/);

    const item = screen.getByRole("menuitem", { name: /Z\s*前后 · 中心/ });
    expect((item.querySelector("svg") as SVGElement).style.transform).toBe("rotate(-225deg)");
    fireEvent.click(item);

    expect(align).toHaveBeenCalledWith(["1", "2"], "z", "center");
    expect(screen.getByRole("menuitem", { name: /X\s*左右 · 最小/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Z\s*前后 · 最大/ })).toBeTruthy();
    expect(screen.queryByText(/向左|向右|双向/)).toBeNull();
  });

  it("不再有组合和解组", () => {
    selection = ["1", "2"];
    renderMenu();
    expect(screen.queryByRole("menuitem", { name: "组合" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "解组" })).toBeNull();
  });

  it("只选 2 个时均布不可用，并写明要几个", () => {
    selection = ["1", "2"];
    renderMenu();
    expect(
      screen.getByRole("menuitem", { name: "均布（至少 3 个物体）" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("选 3 个时可以沿选定方向均布", async () => {
    selection = ["1", "2", "3"];
    renderMenu();
    await openSub(/^均布$/);

    fireEvent.click(screen.getByRole("menuitem", { name: /X\s*左右/ }));

    expect(distribute).toHaveBeenCalledWith(["1", "2", "3"], "x");
  });
});
