// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import type { PermissionId } from "@shared/auth/permissions";
import { ConfigWizardPanel } from "./config-wizard-panel";

const navigate = vi.fn();
const openDialog = vi.fn();
let store: { objects: unknown[]; plcs: unknown[]; motors: unknown[] };
let projectId = "a";

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: {
      id: projectId,
      document: { setup: { controlledObjects: store.objects, plcs: store.plcs, motors: store.motors } },
    },
  }),
}));
vi.mock("@/app/project/setup-hydrate", () => ({
  hydrateSetupFromDocument: () => store,
}));
vi.mock("@/app/pages/console/hooks/use-project-store", () => ({
  useProjectStore: () => store,
}));
vi.mock("@/app/pages/console/hooks/use-console-nav", () => ({
  useConsoleNav: () => ({ activeNav: "devices", navigate }),
}));
vi.mock("@/app/pages/console/hooks/plc-runtime-provider", () => ({
  usePlcRuntime: () => ({
    getPlcRuntime: (plcId: number) => ({ plcId, connection: "disconnected", discoveredMotors: [] }),
  }),
}));
vi.mock(
  "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider",
  () => ({ useAlignmentChecklist: () => ({ allConfirmed: false, openDialog }) }),
);
vi.mock("./steps/step-add-objects", () => ({ StepAddObjects: () => <div>物体步骤</div> }));
vi.mock("./steps/step-add-plc", () => ({ StepAddPlc: () => <div>硬件步骤</div> }));
vi.mock("./steps/step-bind-axes", () => ({ StepBindAxes: () => <div>绑定步骤</div> }));

const OBJECT = {
  id: 1,
  name: "屏幕",
  controlType: "singlePointMove",
  axes: [{ key: "0", custom: false, mount: { x: 0, z: 0 } }],
};

const renderPanel = (permissions: PermissionId[] = ["build.view", "build.edit", "build.debug", "action.view"]) =>
  render(
    <TestPermissionsProvider permissions={permissions}>
      <ConfigWizardPanel />
    </TestPermissionsProvider>,
  );

beforeEach(() => {
  store = { objects: [], plcs: [], motors: [] };
  projectId = "a";
  navigate.mockClear();
  openDialog.mockClear();
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("配置向导", () => {
  it("空工程先看认识页，开始后进入受控物体", () => {
    renderPanel();
    expect(screen.getByText("搭建就是回答三个问题")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /开始搭建/ }));
    expect(screen.getByText("物体步骤")).toBeTruthy();
  });

  it("所有步骤随时能进，不做当前步骤也能往下走", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^绑定/ }));
    expect(screen.getByText("绑定步骤")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^下一步/ }));
    expect(screen.getByText("工程现在能做什么")).toBeTruthy();
  });

  it("回到工程时停在上次的步骤，不同工程互不影响", () => {
    const first = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /主控与驱动/ }));
    first.unmount();

    const again = renderPanel();
    expect(screen.getByText("硬件步骤")).toBeTruthy();
    again.unmount();

    projectId = "b";
    renderPanel();
    expect(screen.getByText("搭建就是回答三个问题")).toBeTruthy();
  });

  it("已有内容的工程直接到还没做完的步骤", () => {
    store = { ...store, objects: [OBJECT] };
    renderPanel();
    expect(screen.getByText("硬件步骤")).toBeTruthy();
  });

  it("结构条显示实时数量", () => {
    store = { ...store, objects: [OBJECT] };
    renderPanel();
    const strip = screen.getByLabelText("工程结构概览");
    expect(strip.textContent).toContain("受控物体 1");
    expect(strip.textContent).toContain("已绑定 0/1");
  });

  it("认识页可以直接去工程结构", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "我熟悉了，去工程结构" }));
    expect(navigate).toHaveBeenCalledWith("devices", { devicesTab: "structure" });
  });
});

describe("检查与下一步", () => {
  const openReview = () => fireEvent.click(screen.getByRole("button", { name: /检查与下一步/ }));

  it("没有设备时可以去编排动作，设备相关项指向对应步骤", () => {
    store = { ...store, objects: [OBJECT] };
    renderPanel();
    openReview();

    fireEvent.click(screen.getAllByRole("button", { name: "去编排动作" })[0]!);
    expect(navigate).toHaveBeenCalledWith("sequences");

    fireEvent.click(screen.getAllByRole("button", { name: "去处理" })[0]!);
    expect(screen.getByText("硬件步骤")).toBeTruthy();
  });

  it("演出模式未确认时可以查看确认项", () => {
    renderPanel();
    openReview();
    fireEvent.click(screen.getByRole("button", { name: "查看确认项" }));
    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("没有调试权限时不显示调试入口", () => {
    renderPanel(["build.view", "build.edit"]);
    openReview();
    expect(screen.queryByRole("button", { name: /^调试/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "去调试" })).toBeNull();
    expect(screen.getByRole("button", { name: /^工程结构/ })).toBeTruthy();
  });
});
