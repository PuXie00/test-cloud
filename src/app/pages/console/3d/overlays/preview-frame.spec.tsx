// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/project/use-project", () => ({
  useProject: () => ({
    currentProject: {
      document: { motion: { actionSequences: [{ id: 3, name: "开场升起" }] } },
    },
  }),
}));

vi.mock("../Viz3DProvider", () => ({ useViz3DContext: () => ({}) }));

import { PreviewFrame } from "./ViewportOverlay";

afterEach(() => cleanup());

describe("PreviewFrame", () => {
  it("frames the 3D view and says which sequence is previewed", () => {
    render(<PreviewFrame sequenceId={3} />);
    expect(screen.getByTestId("preview-frame").className).toContain("border-secondary");
    expect(screen.getByRole("status").textContent).toBe("预览「开场升起」· 设备不动");
  });

  it("still marks the preview when the sequence name is unknown", () => {
    render(<PreviewFrame sequenceId={99} />);
    expect(screen.getByRole("status").textContent).toBe("预览· 设备不动");
  });
});
