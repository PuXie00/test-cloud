// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JogButton } from "./jog-button";

afterEach(() => cleanup());

const renderJog = (props: { disabled?: boolean } = {}) => {
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  const view = render(
    <JogButton ariaLabel="点动正向" onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} {...props}>
      +
    </JogButton>,
  );
  return { onHoldStart, onHoldEnd, view };
};

describe("JogButton 按住时被拿掉也要停", () => {
  it("按住时卸载（换人没了调试权限）先发停止", () => {
    const { onHoldStart, onHoldEnd, view } = renderJog();
    fireEvent.pointerDown(screen.getByRole("button", { name: "点动正向" }));
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it("按住时窗口失焦先发停止，抬起不再重复", () => {
    const { onHoldEnd } = renderJog();
    const button = screen.getByRole("button", { name: "点动正向" });
    fireEvent.pointerDown(button);
    fireEvent(window, new Event("blur"));
    fireEvent.pointerUp(button);
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it("没按住时卸载不发停止", () => {
    const { onHoldEnd, view } = renderJog();
    view.unmount();
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it("按住时变成禁用先发停止", () => {
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const { rerender } = render(
      <JogButton ariaLabel="点动正向" onHoldStart={onHoldStart} onHoldEnd={onHoldEnd}>
        +
      </JogButton>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "点动正向" }));
    rerender(
      <JogButton ariaLabel="点动正向" onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} disabled>
        +
      </JogButton>,
    );
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
  });
});
