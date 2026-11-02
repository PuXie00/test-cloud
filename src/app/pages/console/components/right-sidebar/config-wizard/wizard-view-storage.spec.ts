// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredWizardView, writeStoredWizardView } from "./wizard-view-storage";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("向导步骤记录", () => {
  it("按工程分开记录", () => {
    writeStoredWizardView("a", "binding");
    expect(readStoredWizardView("a")).toBe("binding");
    expect(readStoredWizardView("b")).toBeNull();
  });

  it("读到无效值当作没有记录", () => {
    window.localStorage.setItem("console.devices.wizard.view.a", "skipped");
    expect(readStoredWizardView("a")).toBeNull();
  });

  it("存储不可用时不抛错", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredWizardView("a")).toBeNull();
    expect(() => writeStoredWizardView("a", "objects")).not.toThrow();
  });
});
