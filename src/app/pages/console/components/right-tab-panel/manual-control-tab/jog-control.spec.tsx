// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import { unionDimensions } from "./shared-dimensions";
import { JogControl } from "./jog-control";

const { hookState } = vi.hoisted(() => ({
  hookState: {
    selectedIds: [] as number[],
    snapshots: new Map<number, { descriptor: { id: number; dimensions: unknown[] } }>(),
    objects: [] as unknown[],
    sendJogModel: vi.fn(),
  },
}));

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({ persistManualJog: vi.fn() }),
}));
vi.mock("@/app/project/use-project-document", () => ({
  useProjectDocument: () => undefined,
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
  useProjectStore: () => ({ objects: hookState.objects, motors: [] }),
}));
vi.mock("../../../hooks/manual-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/manual-commands")>()),
  sendJogModel: (items: unknown) => hookState.sendJogModel(items),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const HEIGHT = { key: "height", label: "升降", unit: "mm" };
const ANGLE = { key: "angle", label: "旋转", unit: "°" };
const PITCH = { key: "pitch", label: "摆动 X", unit: "°" };
const YAW = { key: "yaw", label: "摆动 Y", unit: "°" };

type Dim = { key: string; label: string; unit: string };

const snapshot = (id: number, dimensions: Dim[]) => ({
  descriptor: { id, name: `obj${id}`, dimensions },
});

const select = (
  entries: { id: number; dimensions: Dim[]; controlType: string }[],
): Dim[] => {
  hookState.selectedIds = entries.map((entry) => entry.id);
  hookState.snapshots = new Map(entries.map((entry) => [entry.id, snapshot(entry.id, entry.dimensions)]));
  hookState.objects = entries.map((entry) => ({
    id: entry.id,
    controlType: entry.controlType,
    motionParams: {},
  }));
  return unionDimensions(entries.map((entry) => entry.dimensions as never));
};

const LIFT = { id: 1, dimensions: [HEIGHT], controlType: "singlePointMove" };
const SWING = { id: 2, dimensions: [HEIGHT, PITCH, YAW], controlType: "fourPointSwing" };
const ROTATOR = { id: 3, dimensions: [ANGLE], controlType: "singlePointRotation" };

const renderJog = (dimensions: Dim[]) =>
  render(
    <DisplayLengthUnitProvider initialUnit="mm">
      <JogControl dimensions={dimensions as never} />
    </DisplayLengthUnitProvider>,
  );

/** 第 index 行（v1→v3）的正向 / 负向点动按钮 */
const jogButton = (name: "正向点动" | "负向点动", index: number) =>
  screen.getAllByRole("button", { name })[index] as HTMLButtonElement;

beforeEach(() => {
  hookState.selectedIds = [];
  hookState.snapshots = new Map();
  hookState.objects = [];
  hookState.sendJogModel.mockClear();
});

afterEach(() => cleanup());

describe("JogControl 虚轴并集", () => {
  it("单选只显示该物体有的虚轴", () => {
    renderJog(select([LIFT]));
    expect(screen.getByText("虚轴1 升降")).not.toBeNull();
    expect(screen.queryByText(/虚轴2/)).toBeNull();
  });

  it("多选显示虚轴的并集，不是交集", () => {
    renderJog(select([LIFT, SWING]));
    expect(screen.getByText("虚轴1 升降")).not.toBeNull();
    expect(screen.getByText("虚轴2 摆动 X")).not.toBeNull();
    expect(screen.getByText("虚轴3 摆动 Y")).not.toBeNull();
  });

  it("虚轴 1 单位不一致时仍只显示一行，并提示单位不一致", () => {
    renderJog(select([LIFT, ROTATOR]));
    expect(screen.getAllByRole("button", { name: "正向点动" })).toHaveLength(1);
    expect(screen.getByText("单位不一致，按 mm 处理")).not.toBeNull();
  });
});

describe("JogControl 点动指令", () => {
  it("点动某根虚轴只发给有这根虚轴的物体，松开时同样只停这些物体", () => {
    renderJog(select([LIFT, SWING]));
    fireEvent.pointerDown(jogButton("正向点动", 1));
    expect(hookState.sendJogModel).toHaveBeenCalledTimes(1);
    expect(hookState.sendJogModel.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ deviceId: 2, virtualAxisType: 1, direction: 1 }),
    ]);
    fireEvent.pointerUp(jogButton("正向点动", 1));
    expect(hookState.sendJogModel).toHaveBeenCalledTimes(2);
    expect(hookState.sendJogModel.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ deviceId: 2, virtualAxisType: 1, direction: 0 }),
    ]);
  });

  it("虚轴 3 同理，方向取负向", () => {
    renderJog(select([LIFT, SWING]));
    fireEvent.pointerDown(jogButton("负向点动", 2));
    expect(hookState.sendJogModel.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ deviceId: 2, virtualAxisType: 2, direction: 2 }),
    ]);
  });

  it("所有物体都有的虚轴发给全部所选物体", () => {
    renderJog(select([LIFT, SWING]));
    fireEvent.pointerDown(jogButton("正向点动", 0));
    expect(hookState.sendJogModel.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ deviceId: 1, virtualAxisType: 0, direction: 1 }),
      expect.objectContaining({ deviceId: 2, virtualAxisType: 0, direction: 1 }),
    ]);
  });

  it("单选和原来一样发给这个物体", () => {
    renderJog(select([SWING]));
    fireEvent.pointerDown(jogButton("正向点动", 1));
    expect(hookState.sendJogModel.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ deviceId: 2, virtualAxisType: 1 }),
    ]);
  });
});
