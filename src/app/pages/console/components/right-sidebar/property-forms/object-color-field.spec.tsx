// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectColorField, normalizeObjectColor } from "./object-color-field";

afterEach(cleanup);

describe("ObjectColorField", () => {
  it("点色块、用取色器都会回调颜色", () => {
    const onChange = vi.fn();
    render(<ObjectColorField value="#869398" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "颜色 #4ade80" }));
    fireEvent.change(screen.getByLabelText("自定义颜色"), { target: { value: "#123456" } });

    expect(onChange.mock.calls).toEqual([["#4ade80"], ["#123456"]]);
  });

  it("当前是常用色时高亮色块；自定义颜色显示在取色器上", () => {
    const { rerender } = render(<ObjectColorField value="#4ADE80" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "颜色 #4ade80" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    rerender(<ObjectColorField value="#123456" onChange={() => {}} />);
    expect(
      screen.getAllByRole("button").every((button) => button.getAttribute("aria-pressed") !== "true"),
    ).toBe(true);
    expect((screen.getByLabelText("自定义颜色") as HTMLInputElement).value).toBe("#123456");
  });

  it("只有传了 tintModel 才显示模型染色开关", () => {
    const onTint = vi.fn();
    const { rerender } = render(
      <ObjectColorField value="#869398" onChange={() => {}} onTintModelChange={onTint} />,
    );
    expect(screen.queryByRole("switch", { name: "模型染色" })).toBeNull();

    rerender(
      <ObjectColorField
        value="#869398"
        onChange={() => {}}
        tintModel={false}
        onTintModelChange={onTint}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "模型染色" }));
    expect(onTint).toHaveBeenCalledWith(true);
  });

  it("取色器只接受 #rrggbb，其它退回默认色", () => {
    expect(normalizeObjectColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeObjectColor("#abc")).toBe("#869398");
    expect(normalizeObjectColor(null)).toBe("#869398");
  });
});
