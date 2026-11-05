// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepAddObjects } from "./step-add-objects";
import { StepAddPlc } from "./step-add-plc";
import { StepBindAxes } from "./step-bind-axes";

const addObjectFromShape = vi.fn();
const removePlc = vi.fn();
const bindAxis = vi.fn();
const autoBindAxes = vi.fn();
const select = vi.fn();
const clearSelection = vi.fn();
const setTreeFocus = vi.fn();
const navigate = vi.fn();
const scanAll = vi.fn();
const onNavigate = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();

let store: { objects: unknown[]; plcs: unknown[]; motors: unknown[] };
let selection: { multiSelectedIds: number[]; treeFocus: unknown };

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
    error: vi.fn(),
  },
}));
vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({
    ...store,
    addObjectFromShape,
    removePlc,
    bindAxis,
    autoBindAxes,
  }),
}));
vi.mock("@/app/pages/console/hooks/use-selection", () => ({
  useSelection: () => ({
    ...selection,
    select,
    replaceSelection: vi.fn(),
    clearSelection,
    setTreeFocus,
  }),
}));
vi.mock("@/app/pages/console/hooks/use-console-nav", () => ({
  useConsoleNav: () => ({ activeNav: "devices", navigate }),
}));
vi.mock("@/app/pages/console/3d/Viz3DProvider", () => ({
  useViz3DContext: () => ({ focusSelection: vi.fn() }),
}));
vi.mock("@/app/pages/console/hooks/plc-runtime-provider", () => ({
  usePlcRuntime: () => ({
    getPlcRuntime: () => ({ connection: "connected" }),
    scanAll,
  }),
}));
vi.mock("@/app/pages/console/hooks/use-object-deletion", () => ({
  useObjectDeletion: () => ({
    impact: null,
    open: false,
    lastError: null,
    requestDelete: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(),
  }),
}));
vi.mock("../wizard-object-fields", () => ({
  WizardObjectFields: () => <div>物体字段</div>,
}));
vi.mock("../../property-forms/plc-form", () => ({
  PlcForm: () => <div>主控表单</div>,
}));
vi.mock("../../project-edit-boundary", () => ({
  ProjectEditBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock("../dialogs/plc-add-dialog", () => ({
  PlcAddDialog: ({ open }: { open: boolean }) => (open ? <div>手动添加主控弹窗</div> : null),
}));
vi.mock("../dialogs/motor-add-dialog", () => ({
  MotorAddDialog: ({ open, plcId }: { open: boolean; plcId: number }) =>
    open ? <div>添加驱动单元弹窗 {plcId}</div> : null,
}));
vi.mock("../dialogs/plc-scan-dialog", () => ({
  PlcScanDialog: ({ open, results }: { open: boolean; results: { ip: string }[] }) =>
    open ? <div>扫描结果 {results.map((item) => item.ip).join(",")}</div> : null,
}));
vi.mock("../../delete-impact-dialog", () => ({
  DeleteImpactDialog: ({
    impact,
    open,
    onConfirm,
  }: {
    impact?: { summary: string } | null;
    open: boolean;
    onConfirm: () => void;
  }) =>
    open && impact ? (
      <button type="button" onClick={onConfirm}>
        确认删除：{impact.summary}
      </button>
    ) : null,
}));

const axis = (key: string) => ({ key, custom: false, mount: { x: 0, z: 0 } });

const object = (id: number, axisCount = 1, patch: Record<string, unknown> = {}) => ({
  id,
  name: `物体-${id}`,
  controlType: "singlePointMove",
  parentId: null,
  position: { x: 0, y: 4000, z: 0 },
  dimensions: { w: 2000, h: 400, d: 1500 },
  axes: Array.from({ length: axisCount }, (_, index) => axis(String(index))),
  ...patch,
});

const plc = { id: 9, masterTypeId: "AC802_0", ip: "192.168.1.30", status: "offline" };

const motor = (id: number, patch: Record<string, unknown> = {}) => ({
  id,
  productModel: "M",
  plcId: 9,
  busNo: 0,
  axisType: 0,
  nodeAddress: null,
  selected: true,
  controlledObjectId: null,
  axisKey: null,
  params: {},
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  store = { objects: [], plcs: [], motors: [] };
  selection = { multiSelectedIds: [], treeFocus: null };
});

afterEach(() => cleanup());

describe("受控物体", () => {
  it("没有物体时直接显示运动方式，选了就建出物体并选中", () => {
    addObjectFromShape.mockReturnValue(object(5));
    render(<StepAddObjects />);

    fireEvent.click(screen.getByRole("button", { name: /多点倾斜/ }));

    expect(addObjectFromShape).toHaveBeenCalledWith(
      "cube",
      { x: 0 },
      { controlType: "dualTiltFourPointSwing", namePrefix: "多点倾斜" },
    );
    expect(select).toHaveBeenCalledWith(5);
    expect(setTreeFocus).toHaveBeenCalledWith({ kind: "controlled-object", id: 5 });
  });

  it("新物体排在已有物体旁边，不叠在原点", () => {
    store = { ...store, objects: [object(1)] };
    addObjectFromShape.mockReturnValue(object(5));
    render(<StepAddObjects />);

    fireEvent.click(screen.getByRole("button", { name: "添加物体" }));
    fireEvent.click(screen.getByRole("button", { name: /多点摆/ }));

    expect(addObjectFromShape.mock.calls[0]![1]).toEqual({ x: 3000 });
  });

  it("已有物体时运动方式收起，只有选中的物体展开字段", () => {
    store = { ...store, objects: [object(1), object(2)] };
    selection = { ...selection, multiSelectedIds: [2] };
    render(<StepAddObjects />);

    expect(screen.queryByRole("button", { name: /多点摆/ })).toBeNull();
    expect(screen.getAllByText("物体字段")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /物体-2/, pressed: true })).toBeTruthy();
  });

  it("点卡片是真正选中物体，3D 和属性面板会同步", () => {
    store = { ...store, objects: [object(1)] };
    render(<StepAddObjects />);

    fireEvent.click(screen.getByRole("button", { name: /物体-1/, pressed: false }));

    expect(select).toHaveBeenCalledWith(1);
    expect(setTreeFocus).toHaveBeenCalledWith({ kind: "controlled-object", id: 1 });
  });

  it("可以直接打开工程结构继续调参数", () => {
    render(<StepAddObjects />);
    fireEvent.click(screen.getByRole("button", { name: "现在打开" }));
    expect(navigate).toHaveBeenCalledWith("devices", { devicesTab: "structure" });
  });
});

describe("主控与驱动", () => {
  it("已联网会真正发起扫描，并把新主控交给结果弹窗", async () => {
    scanAll.mockResolvedValue([{ ip: "192.168.1.50", plcModel: 1, axis: [] }]);
    render(<StepAddPlc onNavigate={onNavigate} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已联网/ }));
    });

    expect(scanAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("扫描结果 192.168.1.50")).toBeTruthy();
  });

  it("扫到的主控工程里已有时不再提示添加", async () => {
    store = { ...store, plcs: [plc] };
    scanAll.mockResolvedValue([{ ip: plc.ip, plcModel: 1, axis: [] }]);
    render(<StepAddPlc onNavigate={onNavigate} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /已联网/ }));
    });

    expect(screen.queryByText(/扫描结果/)).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith("未发现新主控");
  });

  it("还没到现场可以手动添加，暂时不配直接去检查", () => {
    render(<StepAddPlc onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /还没到现场/ }));
    expect(screen.getByText("手动添加主控弹窗")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /暂时不配/ }));
    expect(onNavigate).toHaveBeenCalledWith("review");
  });

  it("主控下可以添加驱动单元，并按口显示数量", () => {
    store = { ...store, plcs: [plc], motors: [motor(1), motor(2), motor(3, { busNo: 1 })] };
    render(<StepAddPlc onNavigate={onNavigate} />);

    expect(screen.getByText("C 口 2 台 · D 口 1 台")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加驱动单元" }));
    expect(screen.getByText("添加驱动单元弹窗 9")).toBeTruthy();
  });

  it("点主控时清掉物体选中，展开它的配置", () => {
    store = { ...store, plcs: [plc] };
    render(<StepAddPlc onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /192\.168\.1\.30/ }));

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(setTreeFocus).toHaveBeenCalledWith({ kind: "master", id: 9 });
  });

  it("删除带已绑定电机的主控要先确认", () => {
    store = {
      ...store,
      objects: [object(1)],
      plcs: [plc],
      motors: [motor(1, { controlledObjectId: 1, axisKey: "0" })],
    };
    render(<StepAddPlc onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /^删除/ }));
    expect(removePlc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));
    expect(removePlc).toHaveBeenCalledWith(9);
  });

  it("空的主控直接删除", () => {
    store = { ...store, plcs: [plc] };
    render(<StepAddPlc onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /^删除/ }));
    expect(removePlc).toHaveBeenCalledWith(9);
  });
});

describe("绑定", () => {
  it("没有可运动的物体时引导去添加", () => {
    store = { ...store, objects: [object(1, 0, { controlType: "staticProp" })] };
    render(<StepBindAxes onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "去添加物体" }));
    expect(onNavigate).toHaveBeenCalledWith("objects");
  });

  it("没有驱动单元时引导去配置", () => {
    store = { ...store, objects: [object(1)] };
    render(<StepBindAxes onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "去配置主控与驱动" }));
    expect(onNavigate).toHaveBeenCalledWith("hardware");
  });

  it("自动绑定后报告绑定数量", () => {
    store = { ...store, objects: [object(1, 2)], plcs: [plc], motors: [motor(10), motor(11)] };
    autoBindAxes.mockReturnValue({
      assignments: [
        { objectId: 1, axisKey: "0", motorId: 10 },
        { objectId: 1, axisKey: "1", motorId: 11 },
      ],
      unplacedAxisCount: 0,
    });
    render(<StepBindAxes onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "自动绑定" }));

    expect(autoBindAxes).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("已绑定 2 个吊点");
  });

  it("电机不够时说明还差多少，并能去添加", () => {
    store = {
      ...store,
      objects: [object(1, 1), object(2, 1)],
      plcs: [plc],
      motors: [motor(10, { controlledObjectId: 1, axisKey: "0" })],
    };
    render(<StepBindAxes onNavigate={onNavigate} />);

    expect(screen.getByText(/还有 1 个吊点未绑定，但没有可用的驱动单元/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去添加" }));
    expect(onNavigate).toHaveBeenCalledWith("hardware");
  });

  it("全部绑定时不再提示自动绑定", () => {
    store = {
      ...store,
      objects: [object(1)],
      plcs: [plc],
      motors: [motor(10, { controlledObjectId: 1, axisKey: "0" })],
    };
    render(<StepBindAxes onNavigate={onNavigate} />);

    expect(screen.getByText("全部吊点已绑定")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "自动绑定" })).toBeNull();
  });

  it("每个吊点都能在页面上直接选电机", () => {
    store = { ...store, objects: [object(1, 2)], plcs: [plc], motors: [motor(10)] };
    render(<StepBindAxes onNavigate={onNavigate} />);

    expect(screen.getByRole("button", { name: "物体-1 吊1 绑定电机" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "物体-1 吊2 绑定电机" })).toBeTruthy();
  });

  it("选不了的电机直接写明原因，触屏不靠悬停也看得到", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    store = {
      ...store,
      objects: [object(1), object(2)],
      plcs: [plc],
      motors: [motor(10, { controlledObjectId: 2, axisKey: "0" }), motor(11)],
    };
    render(<StepBindAxes onNavigate={onNavigate} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "物体-1 吊1 绑定电机" }));
    });

    expect(screen.getByText("已绑定其他吊点")).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("点物体名会选中它，3D 里看得到是哪一个", () => {
    store = { ...store, objects: [object(1)], plcs: [plc], motors: [motor(10)] };
    render(<StepBindAxes onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /^物体-1/, pressed: false }));

    expect(select).toHaveBeenCalledWith(1);
    expect(setTreeFocus).toHaveBeenCalledWith({ kind: "controlled-object", id: 1 });
  });

  it("不需要绑定的物体只给一句说明", () => {
    store = {
      ...store,
      objects: [object(1), object(2, 0, { controlType: "staticProp" })],
      plcs: [plc],
      motors: [motor(10)],
    };
    render(<StepBindAxes onNavigate={onNavigate} />);
    expect(screen.getByText(/另有 1 个物体不需要绑定/)).toBeTruthy();
    expect(screen.queryByText(/^物体-2/)).toBeNull();
  });
});
