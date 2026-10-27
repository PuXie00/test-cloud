// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TestPermissionsProvider } from "@/app/auth/permissions";
import { StatusControlBar } from "./status-control-bar";

afterEach(() => cleanup());

const renderBar = (props: Partial<Parameters<typeof StatusControlBar>[0]>) =>
  render(
    <StatusControlBar
      objectLabel="升降灯架-01"
      objectSummary=""
      status="就绪"
      objectStatus="ready"
      allowed={() => true}
      {...props}
    />,
  );

describe("StatusControlBar 批量提示", () => {
  it("多选时显示「批量操作中（数量）」和所选物体名称", () => {
    renderBar({
      objectLabel: "升降灯架-01 +2",
      batchNames: ["升降灯架-01", "升降灯架-02", "桁架-01"],
    });
    expect(screen.getByRole("heading", { name: "批量操作中（3）" })).not.toBeNull();
    expect(screen.getByText("升降灯架-01、升降灯架-02、桁架-01")).not.toBeNull();
    expect(screen.queryByText("升降灯架-01 +2")).toBeNull();
  });

  it("单选显示物体名称，没有批量提示", () => {
    renderBar({ batchNames: ["升降灯架-01"] });
    expect(screen.getByRole("heading", { name: "升降灯架-01" })).not.toBeNull();
    expect(screen.queryByText(/批量操作中/)).toBeNull();
  });

  it("没选物体时提示先选择，没有批量提示", () => {
    renderBar({ objectLabel: null, batchNames: [] });
    expect(screen.getByRole("heading", { name: "请先选择受控物体" })).not.toBeNull();
    expect(screen.queryByText(/批量操作中/)).toBeNull();
  });
});

describe("StatusControlBar 按权限显示主操作", () => {
  const renderWith = (permissions: Parameters<typeof TestPermissionsProvider>[0]["permissions"]) =>
    render(
      <TestPermissionsProvider permissions={permissions}>
        <StatusControlBar
          objectLabel="升降灯架-01"
          objectSummary=""
          status="就绪"
          objectStatus="ready"
          allowed={() => true}
        />
      </TestPermissionsProvider>,
    );
  const labels = () => screen.queryAllByRole("button").map((button) => button.textContent);

  it("只有设备状态：使能、复位", () => {
    renderWith(["control.device"]);
    expect(labels()).toEqual(["使能", "复位"]);
  });

  it("只有手动运动：回原、走平", () => {
    renderWith(["control.manual"]);
    expect(labels()).toEqual(["回原", "走平"]);
  });

  it("只有耦合：耦合", () => {
    renderWith(["control.couple"]);
    expect(labels()).toEqual(["耦合"]);
  });

  it("都没有时主操作整块不显示", () => {
    renderWith([]);
    expect(screen.queryByText("主操作")).toBeNull();
  });
});
