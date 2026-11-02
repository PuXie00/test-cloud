import { describe, expect, it } from "vitest";
import type { PlcRuntimeState } from "@/app/pages/console/hooks/plc-runtime-types";
import type { AxisDefinition, ControlledObject, ControlType, Motor, Plc } from "./config-wizard-types";
import {
  getNextWizardStep,
  getWizardCapabilities,
  getWizardCounts,
  getWizardStepProgress,
  nextObjectPlacementX,
  resolveInitialWizardView,
  type WizardCapabilityId,
  type WizardSetup,
} from "./wizard-state";

const axis = (key: string): AxisDefinition => ({ key, custom: false, mount: { x: 0, z: 0 } });

const object = (
  id: number,
  controlType: ControlType,
  axisCount: number,
  patch: Partial<ControlledObject> = {},
): ControlledObject =>
  ({
    id,
    name: `物体-${id}`,
    controlType,
    position: { x: 0, y: 0, z: 0 },
    dimensions: { w: 2000, h: 400, d: 1500 },
    axes: Array.from({ length: axisCount }, (_, index) => axis(String(index))),
    ...patch,
  }) as ControlledObject;

const plc = (id: number): Plc => ({ id, masterTypeId: "AC802_0", ip: `192.168.1.${id}`, status: "offline" });

const motor = (id: number, plcId: number, binding?: { objectId: number; axisKey: string }): Motor => ({
  id,
  productModel: "M",
  plcId,
  busNo: 0,
  axisType: 0,
  nodeAddress: `node-${id}`,
  selected: true,
  controlledObjectId: binding?.objectId ?? null,
  axisKey: binding?.axisKey ?? null,
  params: {},
});

const setup = (patch: Partial<WizardSetup> = {}): WizardSetup => ({
  objects: [],
  plcs: [],
  motors: [],
  ...patch,
});

const runtimeWith = (connected: readonly number[], discoveredMotors: readonly Motor[] = []) => ({
  getPlcRuntime: (plcId: number) =>
    ({
      plcId,
      connection: connected.includes(plcId) ? "connected" : "disconnected",
      discoveredMotors: discoveredMotors
        .filter((item) => item.plcId === plcId)
        .map((item) => ({ id: `d-${item.id}`, plcId, nodeAddress: item.nodeAddress, productModel: item.productModel })),
    }) as unknown as PlcRuntimeState,
});

describe("getWizardCounts", () => {
  it("需要绑定的吊点不含无驱动轴的物体", () => {
    const counts = getWizardCounts(
      setup({
        objects: [object(1, "twoPointSwing", 2), object(2, "staticProp", 0)],
        plcs: [plc(9)],
        motors: [motor(10, 9, { objectId: 1, axisKey: "0" }), motor(11, 9)],
      }),
    );
    expect(counts).toEqual({ objects: 2, axes: 2, boundAxes: 1, motors: 2, plcs: 1 });
  });
});

describe("getWizardStepProgress", () => {
  it("物体：没有是 empty，缺名称或吊点不足是 partial", () => {
    expect(getWizardStepProgress("objects", setup())).toBe("empty");
    expect(
      getWizardStepProgress("objects", setup({ objects: [object(1, "fourPointSwing", 2)] })),
    ).toBe("partial");
    expect(
      getWizardStepProgress(
        "objects",
        setup({ objects: [object(1, "singlePointMove", 1, { name: "  " })] }),
      ),
    ).toBe("partial");
    expect(
      getWizardStepProgress("objects", setup({ objects: [object(1, "singlePointMove", 1)] })),
    ).toBe("done");
  });

  it("主控与驱动：有主控没电机只算 partial", () => {
    expect(getWizardStepProgress("hardware", setup())).toBe("empty");
    expect(getWizardStepProgress("hardware", setup({ plcs: [plc(9)] }))).toBe("partial");
    expect(getWizardStepProgress("hardware", setup({ plcs: [plc(9)], motors: [motor(10, 9)] }))).toBe(
      "done",
    );
  });

  it("绑定：只绑了一部分不算完成", () => {
    const objects = [object(1, "twoPointSwing", 2)];
    expect(getWizardStepProgress("binding", setup({ objects }))).toBe("empty");
    expect(
      getWizardStepProgress(
        "binding",
        setup({ objects, motors: [motor(10, 9, { objectId: 1, axisKey: "0" })] }),
      ),
    ).toBe("partial");
    expect(
      getWizardStepProgress(
        "binding",
        setup({
          objects,
          motors: [
            motor(10, 9, { objectId: 1, axisKey: "0" }),
            motor(11, 9, { objectId: 1, axisKey: "1" }),
          ],
        }),
      ),
    ).toBe("done");
  });

  it("绑定：只有占位物体时没有要绑的，算完成", () => {
    expect(getWizardStepProgress("binding", setup())).toBe("empty");
    expect(getWizardStepProgress("binding", setup({ objects: [object(1, "staticProp", 0)] }))).toBe(
      "done",
    );
  });
});

describe("从哪一步开始", () => {
  const bound = setup({
    objects: [object(1, "singlePointMove", 1)],
    plcs: [plc(9)],
    motors: [motor(10, 9, { objectId: 1, axisKey: "0" })],
  });

  it("下一步是第一个没做完的步骤，全做完是检查", () => {
    expect(getNextWizardStep(setup())).toBe("objects");
    expect(getNextWizardStep(setup({ objects: [object(1, "singlePointMove", 1)] }))).toBe("hardware");
    expect(getNextWizardStep(bound)).toBe("review");
  });

  it("优先回到上次的位置；否则空工程看认识页，有内容接着做", () => {
    expect(resolveInitialWizardView("binding", setup())).toBe("binding");
    expect(resolveInitialWizardView(null, setup())).toBe("intro");
    expect(resolveInitialWizardView(null, setup({ objects: [object(1, "singlePointMove", 1)] }))).toBe(
      "hardware",
    );
    expect(resolveInitialWizardView(null, bound)).toBe("review");
  });
});

describe("nextObjectPlacementX", () => {
  it("第一个放在原点，之后沿 X 排开并留间距", () => {
    expect(nextObjectPlacementX([], 2000)).toBe(0);
    expect(
      nextObjectPlacementX(
        [object(1, "singlePointMove", 1, { position: { x: 1000, y: 0, z: 0 } })],
        2000,
      ),
    ).toBe(1000 + 1000 + 1000 + 1000);
  });

  it("挂载的子物体不参与计算", () => {
    expect(
      nextObjectPlacementX(
        [object(1, "singlePointMove", 1, { parentId: 5, position: { x: 9000, y: 0, z: 0 } })],
        2000,
      ),
    ).toBe(0);
  });
});

describe("getWizardCapabilities", () => {
  const stateOf = (
    capabilities: ReturnType<typeof getWizardCapabilities>,
    id: WizardCapabilityId,
  ) => capabilities.find((item) => item.id === id)!;

  it("没有设备也能预览和编排，设备相关项是未解锁而不是报错", () => {
    const capabilities = getWizardCapabilities(
      setup({ objects: [object(1, "singlePointMove", 1)] }),
      runtimeWith([]),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "preview").state).toBe("ready");
    expect(stateOf(capabilities, "connect").state).toBe("locked");
    expect(stateOf(capabilities, "debug").state).toBe("locked");
    expect(stateOf(capabilities, "linked")).toMatchObject({ state: "locked", targetStep: "hardware" });
    expect(stateOf(capabilities, "show").state).toBe("locked");
  });

  it("只有占位物体时提示还没有可运动的物体", () => {
    const capabilities = getWizardCapabilities(
      setup({ objects: [object(1, "staticProp", 0)] }),
      runtimeWith([]),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "preview")).toMatchObject({ state: "attention", targetStep: "objects" });
  });

  it("单台调试不依赖绑定，联动才要求全部绑定", () => {
    const motors = [motor(10, 9)];
    const capabilities = getWizardCapabilities(
      setup({ objects: [object(1, "twoPointSwing", 2)], plcs: [plc(9)], motors }),
      runtimeWith([9], motors),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "debug").state).toBe("ready");
    expect(stateOf(capabilities, "linked")).toMatchObject({ state: "attention", targetStep: "binding" });
  });

  it("连接后配置和现场对不上时，联动提示去硬件步骤处理", () => {
    const capabilities = getWizardCapabilities(
      setup({
        objects: [object(1, "singlePointMove", 1)],
        plcs: [plc(9)],
        motors: [motor(10, 9, { objectId: 1, axisKey: "0" })],
      }),
      runtimeWith([9]),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "linked")).toMatchObject({ state: "attention", targetStep: "hardware" });
  });

  it("全部绑定、主控已连接且对账一致时可以联动", () => {
    const motors = [motor(10, 9, { objectId: 1, axisKey: "0" })];
    const capabilities = getWizardCapabilities(
      setup({ objects: [object(1, "singlePointMove", 1)], plcs: [plc(9)], motors }),
      runtimeWith([9], motors),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "linked").state).toBe("ready");
  });

  it("全部绑定但主控没连上时，联动等待连接", () => {
    const capabilities = getWizardCapabilities(
      setup({
        objects: [object(1, "singlePointMove", 1)],
        plcs: [plc(9)],
        motors: [motor(10, 9, { objectId: 1, axisKey: "0" })],
      }),
      runtimeWith([]),
      { alignmentConfirmed: false },
    );
    expect(stateOf(capabilities, "connect").state).toBe("attention");
    expect(stateOf(capabilities, "linked")).toMatchObject({ state: "locked", targetStep: "hardware" });
  });

  it("演出模式只看物理对齐确认", () => {
    expect(
      stateOf(
        getWizardCapabilities(setup(), runtimeWith([]), { alignmentConfirmed: true }),
        "show",
      ).state,
    ).toBe("ready");
  });
});
