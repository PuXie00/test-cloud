import { describe, expect, it, vi } from "vitest";
import { DimmedObjects } from "./DimmedObjects";

const handle = (id: string) => ({ id, setDimmed: vi.fn() });

describe("DimmedObjects", () => {
  it("dims listed handles and un-dims the rest", () => {
    const state = new DimmedObjects();
    const a = handle("a");
    const b = handle("b");
    state.set(["a"]);
    state.apply([a, b]);
    expect(a.setDimmed).toHaveBeenCalledWith(true);
    expect(b.setDimmed).toHaveBeenCalledWith(false);
  });

  it("re-applies to handles created after set()", () => {
    const state = new DimmedObjects();
    state.set(["late"]);
    const late = handle("late");
    state.apply([late]);
    expect(late.setDimmed).toHaveBeenCalledWith(true);
  });

  it("clear() un-dims everything", () => {
    const state = new DimmedObjects();
    const a = handle("a");
    state.set(["a"]);
    state.clear();
    state.apply([a]);
    expect(a.setDimmed).toHaveBeenCalledWith(false);
  });
});
