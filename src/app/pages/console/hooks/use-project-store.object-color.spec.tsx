// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import {
  installMemoryProjectAPI,
  uninstallMemoryProjectAPI,
} from "@/app/project/install-memory-project-api";
import { GZ_2025_RECORD } from "@/app/project/test-fixtures";
import { useProject } from "@/app/project/use-project";
import { ProjectStoreProvider, useProjectStore } from "./use-project-store";

/** 没有 C++ 端：任何 csocket 调用都回成功 */
const stubCsocket = () => {
  const ok = async () => ({ ok: true as const, data: { success: true as const } });
  window.csocketApi = new Proxy({}, { get: () => ok }) as unknown as Window["csocketApi"];
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(ProjectProvider, null, createElement(ProjectStoreProvider, null, children));

const renderStoreAndProject = () =>
  renderHook(() => ({ store: useProjectStore(), project: useProject() }), { wrapper });

type Rendered = ReturnType<typeof renderStoreAndProject>["result"];

const openFixtureProject = async (result: Rendered) => {
  await waitFor(() => expect(result.current.project.loading).toBe(false));
  await act(async () => {
    await result.current.project.openProject(GZ_2025_RECORD.folderName);
  });
};

const docObject = (result: Rendered, id: number) =>
  result.current.project.currentProject?.document?.setup.controlledObjects.find(
    (object) => object.id === id,
  );

describe("物体颜色写回工程", () => {
  beforeEach(() => {
    installMemoryProjectAPI();
    stubCsocket();
  });

  afterEach(() => {
    uninstallMemoryProjectAPI();
    // @ts-expect-error test cleanup
    delete window.csocketApi;
  });

  it("改颜色和模型染色写进文档，能撤销 / 重做", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);
    const id = result.current.store.objects[0]!.id;
    const before = docObject(result, id)!.color;
    expect(docObject(result, id)!.tintModel).toBeUndefined();

    act(() => {
      result.current.store.updateObject(id, { color: "#123abc", tintModel: true });
    });
    expect(docObject(result, id)).toMatchObject({ color: "#123abc", tintModel: true });
    expect(result.current.store.findObject(id)).toMatchObject({
      color: "#123abc",
      tintModel: true,
    });

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => expect(result.current.store.findObject(id)?.color).toBe(before));
    expect(docObject(result, id)!.tintModel).toBeUndefined();

    act(() => {
      result.current.project.redoProjectConfiguration();
    });
    await waitFor(() => expect(result.current.store.findObject(id)?.color).toBe("#123abc"));
    expect(docObject(result, id)!.tintModel).toBe(true);
  });

  it("关掉模型染色时文档里不留 tintModel", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);
    const id = result.current.store.objects[0]!.id;

    act(() => {
      result.current.store.updateObject(id, { tintModel: true });
    });
    act(() => {
      result.current.store.updateObject(id, { tintModel: false });
    });
    expect(docObject(result, id)).not.toHaveProperty("tintModel");
  });

  it("取色器拖动（同一次编辑会话）只算一步撤销", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);
    const id = result.current.store.objects[0]!.id;
    const before = docObject(result, id)!.color;

    act(() => {
      expect(result.current.project.beginTrackedEdit("property:color", "修改受控物体")).toBe(true);
    });
    for (const color of ["#110000", "#220000", "#330000"]) {
      act(() => {
        result.current.store.updateObject(id, { color });
      });
    }
    expect(docObject(result, id)!.color).toBe("#330000");
    act(() => {
      result.current.project.commitTrackedEdit("property:color");
    });

    act(() => {
      result.current.project.undoProjectConfiguration();
    });
    await waitFor(() => expect(result.current.store.findObject(id)?.color).toBe(before));
  });

  it("保存后重开工程颜色和染色还在", async () => {
    const { result } = renderStoreAndProject();
    await openFixtureProject(result);
    const id = result.current.store.objects[0]!.id;

    act(() => {
      result.current.store.updateObject(id, { color: "#abcdef", tintModel: true });
    });
    await act(async () => {
      await result.current.project.saveCurrentProject();
    });
    await act(async () => {
      await result.current.project.closeProject();
    });
    await openFixtureProject(result);

    expect(docObject(result, id)).toMatchObject({ color: "#abcdef", tintModel: true });
    await waitFor(() =>
      expect(result.current.store.findObject(id)).toMatchObject({
        color: "#abcdef",
        tintModel: true,
      }),
    );
  });
});
