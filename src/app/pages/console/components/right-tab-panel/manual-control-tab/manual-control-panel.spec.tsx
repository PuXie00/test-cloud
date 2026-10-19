// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  JogControl: ({ disabled, objectIds }: { disabled?: boolean; objectIds?: readonly number[] }) => (
    <div
      data-testid="jog"
      data-disabled={String(Boolean(disabled))}
      data-objects={(objectIds ?? []).join(",")}
    />
  ),
}));
vi.mock("./dimension-control", () => ({
  DimensionControl: ({ disabled, objectIds }: { disabled?: boolean; objectIds?: readonly number[] }) => (
    <div
      data-testid="dimension"
      data-disabled={String(Boolean(disabled))}
      data-objects={(objectIds ?? []).join(",")}
    />
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

describe("ManualControlPanel 联机编辑", () => {
  it("操作传入的物体，顶部说明联机，按钮写明写到哪", () => {
    hookState.snapshots.set(2, snapshot(2, "升降灯架-02"));
    const onSave = vi.fn();
    render(
      <ManualControlPanel
        objectIds={[2]}
        liveLabel="联机编辑 4.0 s 的位姿"
        saveLabel="取当前 → 更新位姿"
        onSaveCurrentPose={onSave}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("联机编辑 4.0 s 的位姿");
    expect(screen.getByRole("heading", { name: "升降灯架-02" })).not.toBeNull();
    expect(screen.getByTestId("jog").dataset.objects).toBe("2");
    expect(screen.getByTestId("dimension").dataset.objects).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "取当前 → 更新位姿" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ objectIds: [2] }));
  });

  it("不能取当前时按钮不可用并说明原因", () => {
    render(
      <ManualControlPanel
        saveLabel="取当前 → 更新位姿"
        saveBlockedReason="设备运动中，停稳后再取当前"
        onSaveCurrentPose={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "取当前 → 更新位姿" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("设备运动中，停稳后再取当前")).not.toBeNull();
  });
});
