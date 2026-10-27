// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import { LeftSidebar } from "../LeftSidebar";
import { RightSidebar } from "../RightSidebar";

vi.mock("@/app/auth/use-auth", () => ({ useAuth: () => ({ user: { displayName: "王操" } }) }));
vi.mock("../build-debug/build-debug-motor-list", () => ({ BuildDebugMotorList: () => null }));
vi.mock("../right-sidebar/config-wizard/config-wizard-panel", () => ({ ConfigWizardPanel: () => null }));
vi.mock("../right-sidebar/project-structure-panel", () => ({ ProjectStructurePanel: () => null }));
vi.mock("../right-sidebar/rules-panel", () => ({ RulesPanel: () => null }));

afterEach(() => cleanup());

describe("按权限显示页面入口", () => {
  it("只有控制：左侧只剩「控制」", () => {
    render(
      <TestPermissionsProvider permissions={["control.run"]}>
        <LeftSidebar active="control" onChange={vi.fn()} />
      </TestPermissionsProvider>,
    );
    expect(screen.getByRole("button", { name: /控制/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /搭建/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /动作/ })).toBeNull();
  });

  it("有进入搭建和动作页时都显示", () => {
    render(
      <TestPermissionsProvider permissions={["build.view", "action.view"]}>
        <LeftSidebar active="control" onChange={vi.fn()} />
      </TestPermissionsProvider>,
    );
    expect(screen.getByRole("button", { name: /搭建/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /动作/ })).toBeTruthy();
  });

  it("搭建只读：只有工程结构和规则页签", () => {
    render(
      <TestPermissionsProvider permissions={["build.view"]}>
        <RightSidebar activeTab="structure" onTabChange={vi.fn()} />
      </TestPermissionsProvider>,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["工程结构", "规则"]);
  });

  it("有调试和编辑权限时四个页签都在", () => {
    render(
      <TestPermissionsProvider permissions={["build.view", "build.edit", "build.debug"]}>
        <RightSidebar activeTab="structure" onTabChange={vi.fn()} />
      </TestPermissionsProvider>,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "工程结构",
      "调试",
      "配置向导",
      "规则",
    ]);
  });
});
