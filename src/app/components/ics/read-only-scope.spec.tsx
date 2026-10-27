// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsePanel } from "./collapse-panel";
import { NumericInput } from "./numeric-input";
import { ReadOnlyScope } from "./read-only-scope";
import { TabBar } from "./tab-bar";

afterEach(() => cleanup());

const Tabs = () => {
  const [active, setActive] = useState<"a" | "b">("a");
  return (
    <TabBar
      tabs={[
        { id: "a", label: "基础" },
        { id: "b", label: "进阶" },
      ]}
      active={active}
      onChange={setActive}
    />
  );
};

describe("ReadOnlyScope", () => {
  it("只读时按钮、输入框禁用，数值框不能步进", () => {
    const onChange = vi.fn();
    render(
      <ReadOnlyScope readOnly>
        <button type="button">删除</button>
        <input aria-label="名称" />
        <NumericInput value={10} onChange={onChange} aria-label="速度" />
      </ReadOnlyScope>,
    );
    expect((screen.getByRole("button", { name: "删除" }) as HTMLButtonElement).matches(":disabled")).toBe(true);
    expect((screen.getByRole("textbox", { name: "名称" }) as HTMLInputElement).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "增加" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("只读时折叠面板仍能展开，页签仍能切换", () => {
    render(
      <ReadOnlyScope readOnly>
        <CollapsePanel title="驱动参数" defaultOpen={false}>
          <span>内容</span>
        </CollapsePanel>
        <Tabs />
      </ReadOnlyScope>,
    );
    expect(screen.queryByText("内容")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "驱动参数" }));
    expect(screen.getByText("内容")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "进阶" }));
    expect(screen.getByRole("tab", { name: "进阶" }).getAttribute("aria-selected")).toBe("true");
  });

  it("不是只读时什么都不包", () => {
    const { container } = render(
      <ReadOnlyScope readOnly={false}>
        <button type="button">删除</button>
      </ReadOnlyScope>,
    );
    expect(container.querySelector("fieldset")).toBeNull();
    expect((screen.getByRole("button", { name: "删除" }) as HTMLButtonElement).matches(":disabled")).toBe(false);
  });
});
