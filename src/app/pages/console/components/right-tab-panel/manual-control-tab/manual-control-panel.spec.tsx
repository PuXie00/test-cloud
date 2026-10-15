// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualControlPanel } from "./manual-control-panel";

const { hookState } = vi.hoisted(() => ({
  hookState: {
    selectedIds: [] as number[],
    snapshots: new Map<number, unknown>(),
    previewSequenceId: null as number | null,
    sequences: [] as { id: number; name: string }[],
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
vi.mock("../../../hooks/use-sequence-preview", () => ({
  useSequencePreview: () => ({ sequenceId: hookState.previewSequenceId }),
}));
vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: { document: { motion: { actionSequences: hookState.sequences } } },
  }),
}));
vi.mock("../../../hooks/use-couple-flow", () => ({
  useCoupleFlow: () => ({
    phase: "idle",
    busy: false,
    preview: null,
    errorMessage: "",
    reset: vi.fn(),
    handleCouple: vi.fn(),
    handleDecouple: vi.fn(),
    handleConfirmPreview: vi.fn(),
  }),
}));
vi.mock("../../../hooks/manual-commands", () => ({
  sendEnableModel: vi.fn(),
  sendHomeModel: vi.fn(),
  sendResetModel: vi.fn(),
}));
vi.mock("./couple-preview-dialog", () => ({ CouplePreviewDialog: () => null }));
vi.mock("./jog-control", () => ({
  JogControl: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="jog" data-disabled={String(Boolean(disabled))} />
  ),
}));
vi.mock("./dimension-control", () => ({
  DimensionControl: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="dimension" data-disabled={String(Boolean(disabled))} />
  ),
}));

const snapshot = (id: number, name: string) => ({
  descriptor: { id, name, status: "ready", dimensions: [] },
  positions: null,
  modelStatus: null,
});

const renderPanel = () => render(<ManualControlPanel onSaveCurrentPose={vi.fn()} />);

const MAIN_ACTIONS = ["耦合", "使能", "复位", "回原", "走平"];

beforeEach(() => {
  hookState.selectedIds = [1];
  hookState.snapshots = new Map<number, unknown>([[1, snapshot(1, "升降灯架-01")]]);
  hookState.previewSequenceId = null;
  hookState.sequences = [{ id: 7, name: "开场" }];
});

afterEach(() => cleanup());

describe("ManualControlPanel 预览中", () => {
  it("没有预览时可以操作，也没有预览提示", () => {
    renderPanel();
    for (const label of MAIN_ACTIONS) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.getByTestId("jog").dataset.disabled).toBe("false");
    expect(screen.getByTestId("dimension").dataset.disabled).toBe("false");
    expect(screen.queryByText(/正在预览/)).toBeNull();
  });

  it("预览中头部提示，所有手动操作不可用", () => {
    hookState.previewSequenceId = 7;
    renderPanel();
    expect(screen.getByText("正在预览「开场」，无法操作")).not.toBeNull();
    for (const label of MAIN_ACTIONS) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId("jog").dataset.disabled).toBe("true");
    expect(screen.getByTestId("dimension").dataset.disabled).toBe("true");
    expect(
      (screen.getByRole("button", { name: "保存当前位姿" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("没选物体时预览提示也显示", () => {
    hookState.selectedIds = [];
    hookState.previewSequenceId = 7;
    renderPanel();
    expect(screen.getByText("请先选择受控物体")).not.toBeNull();
    expect(screen.getByText("正在预览「开场」，无法操作")).not.toBeNull();
  });

  it("找不到序列名时提示通用文案", () => {
    hookState.previewSequenceId = 99;
    renderPanel();
    expect(screen.getByText("正在预览动作序列，无法操作")).not.toBeNull();
  });
});
