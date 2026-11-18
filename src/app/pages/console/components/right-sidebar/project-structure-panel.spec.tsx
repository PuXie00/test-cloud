// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcilePlcOnline } from "@/app/pages/console/hooks/plc-online";
import type { ScannedMaster } from "@/app/pages/console/hooks/plc-runtime-types";
import { SelectionProvider } from "@/app/pages/console/hooks/selection-provider";
import type { ControlledObject, Motor, Plc } from "./config-wizard/config-wizard-types";
import { ProjectStructurePanel } from "./project-structure-panel";

const HOIST = "YZ_AXIS_HOIST_500KG";

let store: { objects: ControlledObject[]; plcs: Plc[]; motors: Motor[] };
let scanMasters: ScannedMaster[] | null;
const addMotorsFromScannedAxes = vi.fn();

vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => ({
    ...store,
    getPlcMotors: (plcId: number) => store.motors.filter((m) => m.plcId === plcId),
    getPlcUnassignedMotors: (plcId: number) =>
      store.motors.filter((m) => m.plcId === plcId && m.controlledObjectId == null),
    getObjectMotorsForPlc: (objectId: number, plcId: number) =>
      store.motors.filter((m) => m.controlledObjectId === objectId && m.plcId === plcId),
    getPlcLinkedObjects: (plcId: number) =>
      store.objects.filter((o) =>
        store.motors.some((m) => m.plcId === plcId && m.controlledObjectId === o.id),
      ),
    findObject: (id: number) => store.objects.find((o) => o.id === id),
    removePlc: vi.fn(),
    removeMotor: vi.fn(),
    removeMotors: vi.fn(),
    bindAxis: vi.fn(),
    addMotorsFromScannedAxes,
    mountObjects: vi.fn(),
  }),
}));
vi.mock("@/app/pages/console/hooks/plc-runtime-provider", () => ({
  usePlcRuntime: () => ({
    getPlcOnline: (plcId: number) => {
      const plc = store.plcs.find((p) => p.id === plcId)!;
      return reconcilePlcOnline(plc, store.motors, scanMasters);
    },
    scan: { masters: scanMasters, at: scanMasters ? Date.now() : null, scanning: false, error: null },
    scanInBackground: vi.fn(),
  }),
}));
vi.mock("@/app/pages/console/hooks/axis-motion", () => ({
  useSetupEditState: () => ({ readOnly: false }),
}));
vi.mock("@/app/pages/console/hooks/use-master-scan", () => ({
  useMasterScan: () => ({ scanning: false, resultsOpen: false, setResultsOpen: vi.fn(), startScan: vi.fn() }),
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
vi.mock("./property-panel", () => ({ PropertySection: () => null }));
vi.mock("./delete-impact-dialog", () => ({ DeleteImpactDialog: () => null }));
vi.mock("./config-wizard/dialogs/motor-add-dialog", () => ({ MotorAddDialog: () => null }));
vi.mock("./config-wizard/dialogs/plc-add-dialog", () => ({ PlcAddDialog: () => null }));
vi.mock("./config-wizard/dialogs/plc-scan-dialog", () => ({ PlcScanDialog: () => null }));

const plc = (id: number, ip: string): Plc => ({ id, ip, masterTypeId: "AC802_0", status: "offline" });

const motor = (id: number, plcId: number, patch: Partial<Motor> = {}): Motor =>
  ({
    id,
    productModel: HOIST,
    plcId,
    busNo: 0,
    axisType: 0,
    nodeAddress: null,
    discoveryId: null,
    selected: true,
    controlledObjectId: null,
    axisKey: null,
    params: {},
    ...patch,
  }) as Motor;

const object = (id: number, name: string): ControlledObject =>
  ({
    id,
    name,
    controlType: "singlePointMove",
    parentId: null,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { w: 1, h: 1, d: 1 },
    axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
  }) as unknown as ControlledObject;

const renderPanel = () =>
  render(
    <SelectionProvider>
      <ProjectStructurePanel />
    </SelectionProvider>,
  );

// 右键菜单打开时 Radix 会把其余内容藏起来（aria-hidden），按选择器找
const masterTree = () => {
  const tree = document.querySelector<HTMLElement>('[role="tree"][aria-label="主控结构"]');
  if (!tree) throw new Error("主控结构 tree not rendered");
  return tree;
};
const row = (treeId: string) => {
  const el = masterTree().querySelector<HTMLElement>(`[data-tree-id="${treeId}"]`);
  if (!el) throw new Error(`row ${treeId} not rendered`);
  return el;
};
const toggleButton = (treeId: string) =>
  row(treeId).querySelector<HTMLButtonElement>('button[aria-label="收起"], button[aria-label="展开"]')!;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  scanMasters = null;
  addMotorsFromScannedAxes.mockReset();
  store = {
    objects: [object(50, "灯架")],
    plcs: [plc(1, "192.168.1.30"), plc(2, "192.168.1.31")],
    motors: [
      motor(10, 1, { controlledObjectId: 50, axisKey: "0" }),
      motor(11, 1),
      motor(20, 2, { controlledObjectId: 50, axisKey: "0" }),
    ],
  };
});

afterEach(cleanup);

describe("工程结构 · 在线", () => {
  const iconClass = (treeId: string) => row(treeId).querySelector("svg.lucide-cpu, svg.lucide-zap")?.getAttribute("class") ?? "";

  it("还没扫描时主控、电机图标都是灰的，不写字", () => {
    renderPanel();
    expect(iconClass("1")).toContain("text-muted-foreground");
    expect(row("1").textContent).not.toMatch(/未扫描|离线/);
    expect(iconClass("11")).toContain("text-muted-foreground");
  });

  it("在线只看扫描：扫到的主控绿图标 + 实轴 / 配置，扫不到灰；型号不符的电机黄", () => {
    scanMasters = [
      { ip: "192.168.1.30", plcModel: 4, axis: [{ busNo: 0, slaveNo: 0, gourdNo: 253 }, { busNo: 0, slaveNo: 1, gourdNo: 99 }] },
    ];
    renderPanel();
    expect(iconClass("1")).toContain("text-show");
    expect(row("1").textContent).toContain("2 / 2");
    expect(iconClass("2")).toContain("text-muted-foreground");
    expect(iconClass("11")).toContain("text-warning");
    expect(row("11").textContent).not.toContain("型号不符");
  });

  it("加入一根待加入实轴时把同口前面的也一起加入", () => {
    scanMasters = [
      {
        ip: "192.168.1.31",
        plcModel: 4,
        axis: [0, 1, 2].map((slaveNo) => ({ busNo: 0, slaveNo, gourdNo: 253 })),
      },
    ];
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "加入工程 C-3" }));
    expect(addMotorsFromScannedAxes).toHaveBeenCalledWith(2, [
      { busNo: 0, slaveNo: 1, gourdNo: 253 },
      { busNo: 0, slaveNo: 2, gourdNo: 253 },
    ]);
  });
});

describe("工程结构 · 展开", () => {
  it("收起的主控不会因为改了别的主控又被撑开，新加的主控自动展开", () => {
    const view = renderPanel();
    fireEvent.click(toggleButton("1"));
    expect(row("1").getAttribute("aria-expanded")).toBe("false");

    store = { ...store, plcs: [store.plcs[0]!, { ...store.plcs[1]!, ip: "192.168.1.99" }] };
    view.rerender(
      <SelectionProvider>
        <ProjectStructurePanel />
      </SelectionProvider>,
    );
    expect(row("1").getAttribute("aria-expanded")).toBe("false");

    store = { ...store, plcs: [...store.plcs, plc(3, "192.168.1.40")], motors: [...store.motors, motor(30, 3)] };
    view.rerender(
      <SelectionProvider>
        <ProjectStructurePanel />
      </SelectionProvider>,
    );
    expect(row("1").getAttribute("aria-expanded")).toBe("false");
    expect(row("3").getAttribute("aria-expanded")).toBe("true");
  });

  it("同一个物体挂在两个主控下，两行各自展开", () => {
    renderPanel();
    expect(row("co:1:50")).toBeTruthy();
    expect(row("co:2:50")).toBeTruthy();
    fireEvent.click(toggleButton("co:1:50"));
    expect(row("co:1:50").getAttribute("aria-expanded")).toBe("true");
    expect(row("co:2:50").getAttribute("aria-expanded")).toBe("false");
  });

  it("双击有子项的行展开 / 收起", () => {
    renderPanel();
    fireEvent.doubleClick(row("co:1:50"));
    expect(row("co:1:50").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("工程结构 · 选中", () => {
  it("再次单击已选中的电机不会取消；Esc 清空", () => {
    renderPanel();
    fireEvent.click(row("11"));
    fireEvent.click(row("11"));
    expect(row("11").getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(row("11"), { key: "Escape" });
    expect(row("11").getAttribute("aria-selected")).toBe("false");
  });

  it("选中物体时它在每个主控下的行都高亮", () => {
    renderPanel();
    fireEvent.click(row("co:1:50"));
    expect(row("co:1:50").getAttribute("aria-selected")).toBe("true");
    expect(row("co:2:50").getAttribute("aria-selected")).toBe("true");
  });

  it("右键先选中这一行", () => {
    renderPanel();
    fireEvent.contextMenu(row("11"));
    expect(row("11").getAttribute("aria-selected")).toBe("true");
  });

  it("Enter 选中聚焦的行", () => {
    renderPanel();
    act(() => row("11").focus());
    fireEvent.keyDown(row("11"), { key: "Enter" });
    expect(row("11").getAttribute("aria-selected")).toBe("true");
  });
});
