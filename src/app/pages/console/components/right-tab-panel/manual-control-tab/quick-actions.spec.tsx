// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickActions } from "./quick-actions";

afterEach(() => cleanup());

describe("QuickActions", () => {
  it("disables save when there is no selection or no chapter", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <QuickActions canSave={false} onSave={onSave} />,
    );
    const button = screen.getByRole("button", { name: "保存当前位姿" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
    rerender(<QuickActions canSave onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "保存当前位姿" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
