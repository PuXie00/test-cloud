// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DriveUnitLabels } from "./DriveUnitLabels";

describe("DriveUnitLabels status color", () => {
  it("tags the label only while running or in alarm", () => {
    const labels = new DriveUnitLabels();
    const el = labels.entry.element;
    labels.setStatus("running");
    expect(el.dataset.status).toBe("running");
    labels.setStatus("alarm");
    expect(el.dataset.status).toBe("alarm");
    for (const status of ["ready", "warning", "disabled", "offline", undefined] as const) {
      labels.setStatus("running");
      labels.setStatus(status);
      expect(el.dataset.status).toBeUndefined();
    }
  });
});
