// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { DimensionControl } from "./dimension-control";

const { hookState } = vi.hoisted(() => ({
  hookState: {
    selectedIds: [] as number[],
    snapshots: new Map<number, unknown>(),
    objects: [] as unknown[],
    goState: { phase: "idle", mode: "abs", entries: [] as unknown[] },
    arm: vi.fn(),
    go: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-selection", () => ({
  useSelection: () => ({
    selectedId: hookState.selectedIds[0] ?? null,
    multiSelectedIds: hookState.selectedIds.length > 1 ? hookState.selectedIds : [],
  }),
}));
vi.mock("../../../hooks/use-controlled-objects", () => ({
  useControlledObjects: () => ({ getById: (id: number) => hookState.snapshots.get(id) }),
}));
vi.mock("../../../hooks/use-project-store", () => ({
  useProjectStore: () => ({ objects: hookState.objects }),
}));
vi.mock("../../../hooks/go-ready-provider", () => ({
  useGoReady: () => ({
    state: hookState.goState,
    arm: hookState.arm,
    go: hookState.go,
    cancel: hookState.cancel,
    clear: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const HEIGHT = { key: "height", label: "升降", unit: "mm" };
const ANGLE = { key: "angle", label: "旋转", unit: "°" };
const PITCH = { key: "pitch", label: "摆动 X", unit: "°" };
const YAW = { key: "yaw", label: "摆动 Y", unit: "°" };

const snapshot = (
  id: number,
  dimensions: { key: string; label: string; unit: string }[],
  positions: { h?: number; p?: number; y?: number } | null,
) => ({ descriptor: { id, name: `obj${id}`, dimensions }, positions });

const motion = (min: number, max: number) => ({ minAngle: min, maxAngle: max });

/** 选中升降灯架（1，只有虚轴 1）和四点摆（2，三根虚轴） */
const selectLiftAndSwing = () => {
  hookState.selectedIds = [1, 2];
  hookState.snapshots = new Map<number, unknown>([
    [1, snapshot(1, [HEIGHT], { h: 100 })],
    [2, snapshot(2, [HEIGHT, PITCH, YAW], { h: 100, p: 5, y: -3 })],
  ]);
  hookState.objects = [
    { id: 1, controlType: "singlePointMove", motionParams: { h: motion(0, 1000) } },
    {
      id: 2,
      controlType: "fourPointSwing",
      motionParams: { h: motion(0, 500), p: motion(-30, 30), y: motion(-20, 20) },
    },
  ];
};

const controlElement = (disabled = false) => (
  <DisplayLengthUnitProvider initialUnit="mm">
    <DimensionControl disabled={disabled} />
  </DisplayLengthUnitProvider>
);

const renderControl = (disabled = false) => render(controlElement(disabled));

const numericOf = (ariaLabel: string) => {
  const numeric = screen.getByLabelText(ariaLabel).closest("[data-history-interaction='numeric']");
  expect(numeric).not.toBeNull();
  return numeric as HTMLElement;
};

const stepUp = (ariaLabel: string) =>
  fireEvent.mouseDown(within(numericOf(ariaLabel)).getByRole("button", { name: "增加" }));

beforeEach(() => {
  hookState.selectedIds = [];
  hookState.snapshots = new Map();
  hookState.objects = [];
  hookState.goState = { phase: "idle", mode: "abs", entries: [] };
  hookState.arm.mockClear();
  hookState.go.mockClear();
  hookState.cancel.mockClear();
});

afterEach(() => cleanup());

describe("DimensionControl 显示", () => {
  it("单选只显示该物体有的虚轴", () => {
    hookState.selectedIds = [1];
    hookState.snapshots = new Map<number, unknown>([[1, snapshot(1, [HEIGHT], { h: 100 })]]);
    hookState.objects = [
      { id: 1, controlType: "singlePointMove", motionParams: { h: motion(0, 1000) } },
    ];
    renderControl();
    expect(screen.getByLabelText("虚轴1")).not.toBeNull();
    expect(screen.queryByLabelText("虚轴2")).toBeNull();
    expect(screen.queryByLabelText("虚轴3")).toBeNull();
  });

  it("多选显示虚轴的并集，不是交集", () => {
    selectLiftAndSwing();
    renderControl();
    expect(screen.getByLabelText("虚轴1")).not.toBeNull();
    expect(screen.getByLabelText("虚轴2")).not.toBeNull();
    expect(screen.getByLabelText("虚轴3")).not.toBeNull();
  });

  it("绝对模式：没设目标时显示物体当前位置", () => {
    selectLiftAndSwing();
    renderControl();
    expect(numericOf("虚轴1").textContent).toContain("100.0");
    expect(numericOf("虚轴2").textContent).toContain("5.0");
    expect(numericOf("虚轴3").textContent).toContain("-3.0");
    expect(numericOf("虚轴1").textContent).not.toContain("--");
  });

  it("绝对模式：各物体位置不一致显示 --", () => {
    selectLiftAndSwing();
    hookState.snapshots.set(1, snapshot(1, [HEIGHT], { h: 250 }));
    renderControl();
    expect(numericOf("虚轴1").textContent).toContain("--");
    // 虚轴 2 只有四点摆有，不受升降灯架影响
    expect(numericOf("虚轴2").textContent).toContain("5.0");
  });

  it("绝对模式：没设目标时输入框跟着当前位置变化", () => {
    selectLiftAndSwing();
    const { rerender } = renderControl();
    expect(numericOf("虚轴1").textContent).toContain("100.0");
    hookState.snapshots.set(1, snapshot(1, [HEIGHT], { h: 420 }));
    hookState.snapshots.set(2, snapshot(2, [HEIGHT, PITCH, YAW], { h: 420, p: 5, y: -3 }));
    rerender(controlElement());
    expect(numericOf("虚轴1").textContent).toContain("420.0");
  });

  it("绝对模式：没有位置数据显示 --", () => {
    selectLiftAndSwing();
    hookState.snapshots.set(1, snapshot(1, [HEIGHT], null));
    renderControl();
    expect(numericOf("虚轴1").textContent).toContain("--");
  });

  it("绝对模式：已设目标的物体显示目标，不是当前位置", () => {
    selectLiftAndSwing();
    hookState.goState = {
      phase: "armed",
      mode: "abs",
      entries: [
        { objectId: "1", target: { v1: 300 }, current: {} },
        { objectId: "2", target: { v1: 200, v2: 5, v3: -3 }, current: {} },
      ],
    };
    const { unmount } = renderControl();
    expect(numericOf("虚轴1").textContent).toContain("--");
    unmount();

    hookState.goState = {
      phase: "armed",
      mode: "abs",
      entries: [
        { objectId: "1", target: { v1: 300 }, current: {} },
        { objectId: "2", target: { v1: 300, v2: 5, v3: -3 }, current: {} },
      ],
    };
    renderControl();
    expect(numericOf("虚轴1").textContent).toContain("300.0");
  });

  it("所选物体虚轴 1 单位不一致时不显示单位", () => {
    hookState.selectedIds = [1, 2];
    hookState.snapshots = new Map<number, unknown>([
      [1, snapshot(1, [HEIGHT], { h: 100 })],
      [2, snapshot(2, [ANGLE], { h: 10 })],
    ]);
    hookState.objects = [
      { id: 1, controlType: "singlePointMove", motionParams: { h: motion(0, 1000) } },
      { id: 2, controlType: "singlePointRotation", motionParams: { h: motion(0, 360) } },
    ];
    renderControl();
    expect(numericOf("虚轴1").textContent).not.toContain("mm");
    expect(numericOf("虚轴1").textContent).not.toContain("°");
  });

  it("单位一致时显示单位", () => {
    selectLiftAndSwing();
    renderControl();
    expect(numericOf("虚轴1").textContent).toContain("mm");
    expect(numericOf("虚轴2").textContent).toContain("°");
  });
});

describe("DimensionControl 写入", () => {
  it("相对模式：只写有这根虚轴的物体，没有这根轴的物体不动", () => {
    selectLiftAndSwing();
    renderControl();
    fireEvent.click(screen.getByRole("tab", { name: "相对" }));
    stepUp("虚轴2");
    expect(hookState.arm).toHaveBeenCalledTimes(1);
    const [entries, mode] = hookState.arm.mock.calls[0] as [
      { objectId: string; target: Record<string, number> }[],
      string,
    ];
    expect(mode).toBe("rel");
    expect(entries.map((entry) => entry.objectId)).toEqual(["2"]);
    expect(entries[0]?.target.v2).toBeCloseTo(5.1);
    // 第一次进入 GO 准备：其余虚轴保持当前位置
    expect(entries[0]?.target.v1).toBe(100);
    expect(entries[0]?.target.v3).toBe(-3);
  });

  it("相对模式：每个物体按自己的行程截断", () => {
    selectLiftAndSwing();
    hookState.snapshots.set(1, snapshot(1, [HEIGHT], { h: 1000 }));
    hookState.snapshots.set(2, snapshot(2, [HEIGHT, PITCH, YAW], { h: 500, p: 0, y: 0 }));
    renderControl();
    fireEvent.click(screen.getByRole("tab", { name: "相对" }));
    stepUp("虚轴1");
    const [entries] = hookState.arm.mock.calls[0] as [
      { objectId: string; target: Record<string, number> }[],
    ];
    expect(entries.map((entry) => [entry.objectId, entry.target.v1])).toEqual([
      ["1", 1000],
      ["2", 500],
    ]);
  });

  it("相对模式：写入后输入框回到 0", () => {
    selectLiftAndSwing();
    renderControl();
    fireEvent.click(screen.getByRole("tab", { name: "相对" }));
    expect(numericOf("虚轴1").textContent).toContain("0");
    stepUp("虚轴1");
    expect(hookState.arm).toHaveBeenCalledTimes(1);
    expect(numericOf("虚轴1").textContent).toContain("0");
    expect(numericOf("虚轴1").textContent).not.toContain("1");
  });

  it("绝对模式：同一个值写给所有有这根轴的物体，其余虚轴保持当前位置", () => {
    selectLiftAndSwing();
    renderControl();
    stepUp("虚轴1");
    const [entries, mode] = hookState.arm.mock.calls[0] as [
      { objectId: string; target: Record<string, number> }[],
      string,
    ];
    expect(mode).toBe("abs");
    // 从显示的当前位置 100 步进 1
    expect(entries.map((entry) => [entry.objectId, entry.target.v1])).toEqual([
      ["1", 101],
      ["2", 101],
    ]);
    expect(entries[1]?.target.v2).toBe(5);
    expect(entries[1]?.target.v3).toBe(-3);
  });
});

describe("DimensionControl GO", () => {
  it("有所选物体的 GO 目标时可以 GO / 清除，作用于所选物体", () => {
    selectLiftAndSwing();
    hookState.goState = {
      phase: "armed",
      mode: "abs",
      entries: [{ objectId: "2", target: { v1: 10, v2: 0, v3: 0 }, current: {} }],
    };
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "选中物体 GO" }));
    expect(hookState.go).toHaveBeenCalledWith(["1", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "取消选中物体 GO" }));
    expect(hookState.cancel).toHaveBeenCalledWith(["1", "2"]);
  });

  it("没有 GO 目标时 GO 和清除不可用", () => {
    selectLiftAndSwing();
    renderControl();
    expect((screen.getByRole("button", { name: "选中物体 GO" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "取消选中物体 GO" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("DimensionControl 当前位置", () => {
  it("每根虚轴旁显示当前位置，目标改了也照旧显示实际位置", () => {
    selectLiftAndSwing();
    hookState.goState = {
      phase: "armed",
      mode: "abs",
      entries: [{ objectId: "1", target: { v1: 400 }, current: {} }],
    };
    renderControl();
    // 虚轴 1 两个物体都在 100；虚轴 2 只有四点摆
    expect(screen.getByLabelText("虚轴1 当前位置").textContent).toBe("当前 100.0");
    expect(screen.getByLabelText("虚轴2 当前位置").textContent).toBe("当前 5.0");
  });

  it("各物体当前位置不一致或没有数据时显示 --", () => {
    selectLiftAndSwing();
    hookState.snapshots.set(1, snapshot(1, [HEIGHT], { h: 200 }));
    renderControl();
    expect(screen.getByLabelText("虚轴1 当前位置").textContent).toBe("当前 --");
  });

  it("传入 objectIds 时操作这些物体而不是全局选择", () => {
    selectLiftAndSwing();
    hookState.selectedIds = [];
    hookState.goState = {
      phase: "armed",
      mode: "abs",
      entries: [{ objectId: "2", target: { v1: 10, v2: 0, v3: 0 }, current: {} }],
    };
    render(
      <DisplayLengthUnitProvider initialUnit="mm">
        <DimensionControl objectIds={[2]} />
      </DisplayLengthUnitProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "选中物体 GO" }));
    expect(hookState.go).toHaveBeenCalledWith(["2"]);
  });
});
