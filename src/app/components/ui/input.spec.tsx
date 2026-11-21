// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectContext } from "@/app/project/project-provider";
import { ProjectEditBoundary } from "@/app/pages/console/components/right-sidebar/project-edit-boundary";
import { Form } from "./forms";
import { Input, type InputProps } from "./input";

afterEach(() => cleanup());

const LABEL = "名称";

/** 让排在后面的微任务（Esc 之后离开输入框）跑完 */
const flushMicrotasks = () => act(async () => {});

const focus = (input: HTMLInputElement) => act(() => input.focus());

const ControlledText = ({
  initial = "hello",
  onValue,
  ...props
}: Partial<InputProps> & { initial?: string; onValue?: (value: string) => void }) => {
  const [value, setValue] = useState(initial);
  return (
    <Input
      aria-label={LABEL}
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onValue?.(event.target.value);
      }}
      {...props}
    />
  );
};

/** 外面常见写法：Number(e.target.value) 存成数 */
const ControlledNumber = ({
  initial = 12 as number | "",
  onValue,
  ...props
}: Partial<InputProps> & { initial?: number | ""; onValue?: (value: number) => void }) => {
  const [value, setValue] = useState<number | "">(initial);
  return (
    <>
      <Input
        type="number"
        aria-label={LABEL}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          onValue?.(next);
        }}
        {...props}
      />
      <output data-testid="parent-value">{String(value)}</output>
    </>
  );
};

const getInput = () => screen.getByLabelText(LABEL) as HTMLInputElement;
const selection = (input: HTMLInputElement) => [input.selectionStart, input.selectionEnd];

describe("Input select-all on focus (like NumericInput)", () => {
  it("selects the whole value when focused (Tab / programmatic)", async () => {
    render(<ControlledText />);
    const input = getInput();
    await focus(input);
    expect(selection(input)).toEqual([0, 5]);
  });

  it("can be turned off with selectOnFocus={false}", async () => {
    render(<ControlledText selectOnFocus={false} />);
    const input = getInput();
    await focus(input);
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it("selects number values too", async () => {
    render(<ControlledNumber initial={1234} />);
    const input = getInput();
    const select = vi.spyOn(input, "select");
    await focus(input);
    expect(select).toHaveBeenCalled();
  });

  it("keeps the selection after the click / tap that focused it, but not on later clicks", async () => {
    render(<ControlledText />);
    const input = getInput();
    fireEvent.mouseDown(input, { button: 0 });
    await focus(input);
    // fireEvent 返回 false = preventDefault 了：Chrome 不会在 mouseup 把全选改成光标
    expect(fireEvent.mouseUp(input, { button: 0 })).toBe(false);
    fireEvent.mouseDown(input, { button: 0 });
    expect(fireEvent.mouseUp(input, { button: 0 })).toBe(true);
  });

  it("still calls the caller's own focus / mouse handlers", async () => {
    const onFocus = vi.fn();
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    render(<ControlledText onFocus={onFocus} onMouseDown={onMouseDown} onMouseUp={onMouseUp} />);
    const input = getInput();
    fireEvent.mouseDown(input, { button: 0 });
    await focus(input);
    fireEvent.mouseUp(input, { button: 0 });
    expect([onFocus, onMouseDown, onMouseUp].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe("Input Escape (like NumericInput)", () => {
  it("reverts to the value it had when focused and leaves the field", async () => {
    const onValue = vi.fn();
    const onKeyDown = vi.fn();
    render(<ControlledText onValue={onValue} onKeyDown={onKeyDown} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "world" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("hello");
    expect(onValue).toHaveBeenLastCalledWith("hello");
    expect(onKeyDown).toHaveBeenCalled();
    await flushMicrotasks();
    expect(document.activeElement).not.toBe(input);
  });

  it("after Enter only discards what was typed since", async () => {
    render(<ControlledText />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("first");
  });

  it("does nothing while an IME is composing", async () => {
    render(<ControlledText />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "ni" } });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    await flushMicrotasks();
    expect(input.value).toBe("ni");
    expect(document.activeElement).toBe(input);
  });

  it("can be turned off with revertOnEscape={false}", async () => {
    render(<ControlledText revertOnEscape={false} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "draft message" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await flushMicrotasks();
    expect(input.value).toBe("draft message");
    expect(document.activeElement).toBe(input);
  });

  it("works for uncontrolled inputs", async () => {
    const onChange = vi.fn();
    render(<Input aria-label={LABEL} defaultValue="abc" onChange={onChange} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("abc");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("reverts a number field to the number it had when focused", async () => {
    render(<ControlledNumber initial={12} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.getByTestId("parent-value").textContent).toBe("5");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByTestId("parent-value").textContent).toBe("12");
    expect(input.value).toBe("12");
  });

  it("does not write 0 when reverting a mixed (empty) number field", async () => {
    const onValue = vi.fn();
    render(<ControlledNumber initial="" onValue={onValue} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onValue.mock.calls).toEqual([[5]]);
  });
});

describe("Input number editing (like NumericInput's draft)", () => {
  it("can be cleared and retyped although the parent stores Number(value)", async () => {
    const onValue = vi.fn();
    render(<ControlledNumber initial={12} onValue={onValue} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "" } });
    // 外面拿到的仍是 ""（Number → 0），但框里不被回写成 "0"
    expect(onValue).toHaveBeenLastCalledWith(0);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.value).toBe("5");
    expect(screen.getByTestId("parent-value").textContent).toBe("5");
    fireEvent.blur(input);
    expect(input.value).toBe("5");
  });

  it("passes every change through, including empty, so Apply / Execute sees what is shown", async () => {
    const seen: string[] = [];
    const StringParent = () => {
      const [text, setText] = useState("100");
      return (
        <Input
          type="number"
          aria-label={LABEL}
          precision={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            seen.push(event.target.value);
          }}
        />
      );
    };
    render(<StringParent />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "-2.5" } });
    expect(seen).toEqual(["", "-2.5"]);
  });

  it("after blur shows the parent's value again", async () => {
    render(<ControlledNumber initial={12} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("0");
  });

  it("accepts decimals up to precision and truncates the rest", async () => {
    const onValue = vi.fn();
    render(<ControlledNumber initial={0} precision={1} onValue={onValue} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "1.25" } });
    expect(input.value).toBe("1.2");
    expect(onValue).toHaveBeenLastCalledWith(1.2);
  });

  it("integer fields refuse the decimal point key; every number field refuses 'e'", () => {
    render(
      <>
        <Input type="number" aria-label="整数" value={1} onChange={() => {}} />
        <Input type="number" aria-label="小数" precision={1} value={1} onChange={() => {}} />
      </>,
    );
    const integer = screen.getByLabelText("整数");
    const decimal = screen.getByLabelText("小数");
    expect(fireEvent.keyDown(integer, { key: "." })).toBe(false);
    expect(fireEvent.keyDown(decimal, { key: "." })).toBe(true);
    expect(fireEvent.keyDown(integer, { key: "e" })).toBe(false);
    expect(fireEvent.keyDown(decimal, { key: "E" })).toBe(false);
    expect(fireEvent.keyDown(decimal, { key: "5" })).toBe(true);
  });

  it("steppers show the stepped value even while a draft is open", async () => {
    render(<ControlledNumber initial={12} showStepper step={1} />);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "增加" }));
    expect(input.value).toBe("1");
  });
});

describe("Input inside ProjectEditBoundary", () => {
  const createProject = () => {
    let activeOwner: string | null = null;
    const beginTrackedEdit = vi.fn((owner: string) => {
      if (activeOwner != null) return false;
      activeOwner = owner;
      return true;
    });
    const commitTrackedEdit = vi.fn((owner: string) => {
      if (activeOwner !== owner) return { ok: false as const, changed: false as const, reason: "x" };
      activeOwner = null;
      return { ok: true as const, changed: true };
    });
    const cancelTrackedEdit = vi.fn((owner: string) => {
      if (activeOwner !== owner) return { ok: false as const, changed: false as const, reason: "x" };
      activeOwner = null;
      return { ok: true as const, changed: true };
    });
    return {
      beginTrackedEdit,
      commitTrackedEdit,
      cancelTrackedEdit,
      value: { beginTrackedEdit, commitTrackedEdit, cancelTrackedEdit } as unknown as ComponentProps<
        typeof ProjectContext.Provider
      >["value"],
    };
  };

  const renderInBoundary = (project: ReturnType<typeof createProject>) =>
    render(
      <ProjectContext.Provider value={project.value}>
        <ProjectEditBoundary ownerPrefix="property:a" label="修改">
          <ControlledText name="name" />
        </ProjectEditBoundary>
      </ProjectContext.Provider>,
    );

  it("focus → change → blur is still one transaction", async () => {
    const project = createProject();
    renderInBoundary(project);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => input.blur());
    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.commitTrackedEdit).toHaveBeenCalledTimes(1);
  });

  it("Escape reverts, cancels the transaction and does not commit when the field then blurs", async () => {
    const project = createProject();
    renderInBoundary(project);
    const input = getInput();
    await focus(input);
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await flushMicrotasks();
    expect(input.value).toBe("hello");
    expect(project.cancelTrackedEdit).toHaveBeenCalledTimes(1);
    expect(project.commitTrackedEdit).not.toHaveBeenCalled();
    expect(project.beginTrackedEdit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });
});

describe("Input inside Form (react-hook-form)", () => {
  it("Escape puts the form value back", async () => {
    const onFinish = vi.fn();
    render(
      <Form initialValues={{ name: "plc-1" }} onFinish={onFinish}>
        <Form.Item name="name" label="名称">
          <Input aria-label={LABEL} />
        </Form.Item>
        <button type="submit">提交</button>
      </Form>,
    );
    const input = getInput();
    await focus(input);
    expect(selection(input)).toEqual([0, 5]);
    fireEvent.change(input, { target: { value: "plc-2" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "提交" }));
    });
    expect(onFinish).toHaveBeenCalledWith({ name: "plc-1" });
  });
});
