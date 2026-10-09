import { describe, expect, it, vi } from "vitest";
import { MotorSelectionManager } from "./MotorSelectionManager";

describe("MotorSelectionManager", () => {
  it("多选去重，同一集合不重复通知", () => {
    const onChange = vi.fn();
    const manager = new MotorSelectionManager(onChange);
    manager.set(["1", "2", "1"]);
    manager.set(["1", "2"]);
    expect(manager.getSelection()).toEqual(["1", "2"]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(["1", "2"]);
  });

  it("清空后通知空列表", () => {
    const onChange = vi.fn();
    const manager = new MotorSelectionManager(onChange);
    manager.set(["3"]);
    manager.clear();
    expect(manager.getSelection()).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
