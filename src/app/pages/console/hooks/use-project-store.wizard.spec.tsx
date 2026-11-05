// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { ProjectProvider } from "@/app/project/project-provider";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProjectStoreProvider, useProjectStore } from "./use-project-store";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ProjectProvider, null, createElement(ProjectStoreProvider, null, children));

const openProject = async () => {
  const view = renderHook(() => ({ store: useProjectStore(), project: useProject() }), { wrapper });
  await waitFor(() => expect(view.result.current.project.loading).toBe(false));
  await act(async () => {
    await view.result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
  return view.result;
};

describe("向导用到的工程操作", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    const ok = async () => ({ ok: true as const, data: { success: true as const } });
    window.csocketApi = {
      openProject: ok,
      addModelWithDefaultValues: ok,
      modifyModelType: ok,
      configureModelParamModel: ok,
      deleteModelPlc: ok,
      syncMotorPlc: ok,
    } as unknown as Window["csocketApi"];
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    delete (window as unknown as { csocketApi?: unknown }).csocketApi;
  });

  it("新建物体时带上运动方式，吊点和名称都对应，并写进工程文档", async () => {
    const result = await openProject();
    const before = result.current.store.objects.length;

    let created: ReturnType<typeof result.current.store.addObjectFromShape> = null;
    await act(async () => {
      created = result.current.store.addObjectFromShape(
        "cube",
        { x: 5000 },
        { controlType: "dualTiltFourPointSwing", namePrefix: "多点倾斜" },
      );
    });

    expect(created).toMatchObject({
      name: "多点倾斜-01",
      controlType: "dualTiltFourPointSwing",
      position: { x: 5000, y: 4000, z: 0 },
    });
    expect(result.current.store.objects).toHaveLength(before + 1);
    expect(result.current.store.objects.at(-1)?.axes).toHaveLength(4);
    expect(result.current.project.currentProject?.document?.setup.controlledObjects.at(-1)).toMatchObject(
      { name: "多点倾斜-01" },
    );
  });

  it("不带选项时沿用原来按形状命名和默认控制类型", async () => {
    const result = await openProject();
    await act(async () => {
      result.current.store.addObjectFromShape("cube");
    });
    expect(result.current.store.objects.at(-1)?.name).toMatch(/^立方体-\d+$/);
  });

  it("自动绑定把空闲电机绑到吊点，并且一次撤销全部还原", async () => {
    const result = await openProject();

    await act(async () => {
      result.current.store.addObjectFromShape("cube", {}, { controlType: "dualTiltFourPointSwing" });
    });
    const object = result.current.store.objects.at(-1)!;
    const plcId = result.current.store.plcs[0]!.id;
    await act(async () => {
      result.current.store.addMotor({ productModel: result.current.store.motors[0]!.productModel, plcId, busNo: 1 }, 4);
    });
    const bindingsOf = () =>
      result.current.store.motors.filter((motor) => motor.controlledObjectId === object.id);
    expect(bindingsOf()).toHaveLength(0);

    let plan: ReturnType<typeof result.current.store.autoBindAxes> | null = null;
    await act(async () => {
      plan = result.current.store.autoBindAxes();
    });

    expect(plan!.assignments.filter((item) => item.objectId === object.id)).toHaveLength(4);
    expect(bindingsOf().map((motor) => motor.axisKey).sort()).toEqual(["0", "1", "2", "3"]);
    expect(new Set(bindingsOf().map((motor) => `${motor.plcId}:${motor.busNo}`)).size).toBe(1);

    expect(result.current.project.undoLabel).toBe("自动绑定");
    const allBound = result.current.store.motors.filter((motor) => motor.controlledObjectId != null).length;
    await act(async () => {
      result.current.project.undoProjectConfiguration();
    });
    expect(bindingsOf()).toHaveLength(0);
    expect(result.current.store.motors.filter((motor) => motor.controlledObjectId != null).length).toBe(
      allBound - plan!.assignments.length,
    );
  });

  it("没有可分配的电机时不产生撤销记录", async () => {
    const result = await openProject();
    await act(async () => {
      result.current.store.removeMotors(result.current.store.motors.map((motor) => motor.id));
    });
    const undoLabelBefore = result.current.project.undoLabel;

    let plan: ReturnType<typeof result.current.store.autoBindAxes> | null = null;
    await act(async () => {
      plan = result.current.store.autoBindAxes();
    });

    expect(plan!.assignments).toEqual([]);
    expect(result.current.project.undoLabel).toBe(undoLabelBefore);
    expect(undoLabelBefore).not.toBe("自动绑定");
  });
});
