// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { ProjectProvider } from "@/app/project/project-provider";
import { ProgramProvider } from "@/app/pages/console/hooks/use-program";
import { ProjectStoreProvider } from "@/app/pages/console/hooks/use-project-store";
import { ActionBuilderProvider } from "./action-builder-context";
import { useActionBuilder } from "./use-action-builder";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    ProjectProvider,
    null,
    createElement(
      ProjectStoreProvider,
      null,
      createElement(ProgramProvider, null, createElement(ActionBuilderProvider, null, children)),
    ),
  );

describe("objects following the clicked block", () => {
  it("keeps the block selected when the followed objects sync back, and clears it on a real object pick", () => {
    const { result } = renderHook(() => useActionBuilder(), { wrapper });
    act(() => {
      result.current.handleSelectionChange({ kind: "block", blockId: "pose" });
      result.current.handleObjectsFollow([8]);
    });
    expect(result.current.selectedObjectIds).toEqual([8]);

    // 全局选中同步回来：是跟随产生的那一次，块的选中保留
    act(() => result.current.handleObjectsSelect([8]));
    expect(result.current.selection).toEqual({ kind: "block", blockId: "pose" });

    // 之后在 3D 里再点物体：照旧清掉块的选中
    act(() => result.current.handleObjectsSelect([8]));
    expect(result.current.selection).toBeNull();
  });

  it("does not swallow a different object pick", () => {
    const { result } = renderHook(() => useActionBuilder(), { wrapper });
    act(() => {
      result.current.handleSelectionChange({ kind: "block", blockId: "pose" });
      result.current.handleObjectsFollow([8]);
    });
    act(() => result.current.handleObjectsSelect([9]));
    expect(result.current.selection).toBeNull();
    expect(result.current.selectedObjectIds).toEqual([9]);
  });
});
