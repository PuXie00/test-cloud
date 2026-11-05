// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";
import type { MultiLevelConfig } from "@/app/project/multi-level-hoist";
import { MultiLevelSection } from "./multi-level-section";

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { warning: toastWarning } }));

const changes: MultiLevelConfig[] = [];

const Harness = ({ initial, stroke }: { initial: MultiLevelConfig; stroke: { min: number; max: number } }) => {
  const [config, setConfig] = useState(initial);
  return (
    <DisplayLengthUnitProvider initialUnit="mm">
      <MultiLevelSection
        config={config}
        stroke={stroke}
        onChange={(next) => {
          changes.push(next);
          setConfig(next);
        }}
      />
    </DisplayLengthUnitProvider>
  );
};

const stepUp = (label: string) => {
  const field = screen.getByLabelText(label).closest("[data-history-interaction='numeric']") as HTMLElement;
  const button = within(field).getByRole("button", { name: "增加" });
  fireEvent.mouseDown(button);
  fireEvent.mouseUp(button);
};

afterEach(() => {
  cleanup();
  changes.length = 0;
  toastWarning.mockClear();
});

describe("MultiLevelSection", () => {
  it("adds points into the widest gap and removes them", () => {
    render(<Harness initial={{ adjustDistances: [], decelerationRatio: 50 }} stroke={{ min: 0, max: 1000 }} />);
    expect(screen.getByText("中间分段点（0/10）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加分段点" }));
    fireEvent.click(screen.getByRole("button", { name: "添加分段点" }));
    expect(changes.at(-1)?.adjustDistances).toEqual([250, 500]);
    fireEvent.click(screen.getByRole("button", { name: "删除分段点 1" }));
    expect(changes.at(-1)?.adjustDistances).toEqual([500]);
  });

  it("re-sorts after an edit", () => {
    render(<Harness initial={{ adjustDistances: [100, 105], decelerationRatio: 50 }} stroke={{ min: 0, max: 1000 }} />);
    stepUp("分段点 1");
    expect(changes.at(-1)?.adjustDistances).toEqual([105, 110]);
  });

  it("refuses a duplicate position and tells why", () => {
    render(<Harness initial={{ adjustDistances: [100, 110], decelerationRatio: 50 }} stroke={{ min: 0, max: 1000 }} />);
    stepUp("分段点 1");
    expect(toastWarning).toHaveBeenCalledWith("已经有这个位置的分段点");
    expect(changes).toHaveLength(0);
  });

  it("marks points outside a shrunk stroke and stops adding at ten", () => {
    render(
      <Harness
        initial={{ adjustDistances: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1500], decelerationRatio: 50 }}
        stroke={{ min: 0, max: 1000 }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("1 个分段点不在行程范围内，不会下发");
    expect((screen.getByRole("button", { name: "添加分段点" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
