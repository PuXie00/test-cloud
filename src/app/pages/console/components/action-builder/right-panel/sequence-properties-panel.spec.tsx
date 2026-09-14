// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DisplayLengthUnitProvider } from "@/app/project/display-length-unit-provider";

import { resolveActionSequence } from "@/app/project/action-sequence/resolve-sequence";

import type {

  ActionSequenceConfig,

  AxisMotionProfiles,

  MotionProfile,

} from "@/app/project/action-sequence/types";

import type { SequenceSelection } from "../sequence-selection";

import {

  SequencePropertiesPanel,

  type SequencePropertiesPanelProps,

} from "./sequence-properties-panel";



const trap = (accelMs: number, decelMs: number): MotionProfile => ({

  kind: "trapezoid",

  params: { accelMs, decelMs },

});



const profiles = (accelMs: number, decelMs: number): AxisMotionProfiles => ({

  v1: trap(accelMs, decelMs),

  v2: trap(accelMs, decelMs),

  v3: trap(accelMs, decelMs),

});



const { builderState } = vi.hoisted(() => ({

  builderState: {

    current: {

      getTimelineObject: (_objectId?: number) => undefined as

        | {

            rangeByAxis?: Partial<

              Record<"v1" | "v2" | "v3", { min: number; max: number }>

            >;

            controlType?: string;

            enabledAxes?: Array<"v1" | "v2" | "v3">;

            maxSpeedByAxis?: Partial<Record<"v1" | "v2" | "v3", number>>;

            minAccelTimeByAxis?: Partial<Record<"v1" | "v2" | "v3", number>>;

          }

        | undefined,

      handleApplyPoseAxisWrite: vi.fn(),

    },

  },

}));



vi.mock("../use-action-builder", () => ({

  useActionBuilder: () => builderState.current,

}));



const sequence: ActionSequenceConfig = {

  id: 1,

  name: "Seq",

  trajectoryMode: "non-forced",

  blocks: [

    { id: "pose", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 1, v2: 2, v3: 3 } },

    { id: "later", kind: "pose", objectId: 7, atMs: 2500, pose: { v1: 4, v2: 5, v3: 6 } },

    { id: "enable", kind: "instruction",
      presetId: "set-enabled", objectId: 7, atMs: 500, instr: { enabled: true } },

    {

      id: "static",

      kind: "static-preset",

      presetId: "static-flat",

      atMs: 2000,

      orderedObjectIds: [8, 9],

      params: { v1: 0, v2: 0, v3: 0 },

    },

    {

      id: "dynamic",

      kind: "dynamic-preset",

      presetId: "dynamic-level",

      startMs: 3000,

      endMs: 4000,

      orderedObjectIds: [10, 11],

      params: { startV1: 0, targetV1: 100, v2: 0, v3: 0 },

      profiles: profiles(200, 200),

    },

  ],

  segments: [],

};

const resolved = resolveActionSequence(sequence);



const handlers = {

  onReplaceBlock: vi.fn(),

  onUpdateSegment: vi.fn(),

  onDeleteBlock: vi.fn(),

};



const renderPanel = (overrides: Partial<SequencePropertiesPanelProps> = {}) => {

  const nextSequence = overrides.sequence ?? sequence;

  const props: SequencePropertiesPanelProps = {

    sequence: nextSequence,

    resolved: nextSequence === sequence ? resolved : resolveActionSequence(nextSequence),

    selection: null,

    ...handlers,

    ...overrides,

  };

  return render(

    <DisplayLengthUnitProvider initialUnit="mm">

      <SequencePropertiesPanel {...props} />

    </DisplayLengthUnitProvider>,

  );

};



const stepUp = (ariaLabel: string) => {

  const readout = screen.getByLabelText(ariaLabel);

  const numeric = readout.closest("[data-history-interaction='numeric']");

  expect(numeric).not.toBeNull();

  fireEvent.mouseDown(within(numeric as HTMLElement).getByRole("button", { name: "增加" }));

};



afterEach(() => {

  cleanup();

  builderState.current.getTimelineObject = () => undefined;

  builderState.current.handleApplyPoseAxisWrite.mockClear();

  handlers.onReplaceBlock.mockClear();

  handlers.onUpdateSegment.mockClear();

  handlers.onDeleteBlock.mockClear();

});



describe("SequencePropertiesPanel states", () => {

  it("does not render a sequence-level trajectory switch when nothing is selected", () => {

    renderPanel({ selection: null });

    expect(screen.queryByRole("switch", { name: "强制轨迹" })).toBeNull();

    expect(screen.queryByRole("heading", { name: "动作序列" })).toBeNull();

  });



  it.each([

    [{ kind: "block", blockId: "pose" }, /位姿/],

    [{ kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" }, /运动区间/],

    [{ kind: "block", blockId: "enable" }, /使能指令/],

    [{ kind: "block", blockId: "static" }, /静态预设/],

    [{ kind: "block", blockId: "dynamic" }, /动态预设/],

  ] as const)("renders properties for %#", (selection, heading) => {

    renderPanel({ selection: selection as SequenceSelection });

    expect(screen.getByRole("heading", { name: heading })).not.toBeNull();

  });

});



describe("SequencePropertiesPanel edits", () => {

  it("replaces a pose block when an axis changes", () => {

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    stepUp("虚轴1");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({

        id: "pose",

        kind: "pose",

        pose: { v1: 2, v2: 2, v3: 3 },

      }),

    );

  });



  it("steps v2/v3 by 0.1 and clamps pose axes to configured range", () => {

    builderState.current.getTimelineObject = () => ({

      rangeByAxis: {

        v1: { min: 0, max: 1 },

        v2: { min: -20, max: 20 },

        v3: { min: -20, max: 20 },

      },

    });

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    stepUp("虚轴1");

    expect(handlers.onReplaceBlock).not.toHaveBeenCalled();

    stepUp("虚轴2");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({ pose: { v1: 1, v2: 2.1, v3: 3 } }),

    );

  });



  it("adds a relative delta onto the current pose", () => {

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    fireEvent.click(screen.getByRole("tab", { name: "相对" }));

    expect(screen.getByLabelText("虚轴1").textContent).toContain("0");

    stepUp("虚轴1");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({ pose: { v1: 2, v2: 2, v3: 3 } }),

    );

  });



  it("restores absolute pose values when switching back from relative", () => {

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    fireEvent.click(screen.getByRole("tab", { name: "相对" }));

    fireEvent.click(screen.getByRole("tab", { name: "绝对" }));

    expect(screen.getByLabelText("虚轴1").textContent).toContain("1");

  });



  it("shows segment duration, ms phase fields, and 加速结束 slider", () => {

    renderPanel({

      selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" },

    });

    expect(screen.getByRole("heading", { name: /运动区间/ })).not.toBeNull();

    expect(screen.getByLabelText("时长").getAttribute("aria-readonly")).toBe("true");

    expect(screen.getByRole("spinbutton", { name: "加速时间" })).not.toBeNull();

    expect(screen.getByRole("spinbutton", { name: "匀速时间" }).getAttribute("aria-readonly")).toBe(

      "true",

    );

    expect(screen.getByRole("spinbutton", { name: "减速时间" })).not.toBeNull();

    expect(screen.queryByRole("spinbutton", { name: "加速占比" })).toBeNull();

    expect(screen.getByRole("slider", { name: "加速结束" })).not.toBeNull();

  });



  it("shows 加速结束 slider and 超过上限 when segment peak exceeds axis max", () => {

    builderState.current.getTimelineObject = () => ({

      enabledAxes: ["v1"],

      maxSpeedByAxis: { v1: 1 },

    });

    renderPanel({

      selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" },

    });

    expect(screen.getByRole("heading", { name: /运动区间/ })).not.toBeNull();

    expect(screen.getByRole("slider", { name: "加速结束" })).not.toBeNull();

    expect(screen.getByText(/超过上限/)).not.toBeNull();

  });



  it("shows chart sliders without a velocity-limit for a dynamic preset", () => {

    renderPanel({ selection: { kind: "block", blockId: "dynamic" } });

    expect(screen.getByRole("slider", { name: "加速结束" })).not.toBeNull();

    expect(document.querySelector('[data-testid="velocity-limit"]')).toBeNull();

  });



  it("updates the segment trapezoid profiles with accelMs/decelMs", () => {

    renderPanel({

      selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" },

    });

    expect(screen.getByRole("combobox", { name: "曲线类型" })).not.toBeNull();

    const accel = screen.getByRole("spinbutton", { name: "加速时间" });

    fireEvent.change(accel, { target: { value: "0.5" } });

    fireEvent.blur(accel);

    expect(handlers.onUpdateSegment).toHaveBeenCalledWith("pose", "later", {

      profiles: expect.objectContaining({

        v1: expect.objectContaining({

          kind: "trapezoid",

          params: expect.objectContaining({ accelMs: 500 }),

        }),

      }),

    });

  });



  it("shows short-phase warnings with minAccelTime ms", () => {

    builderState.current.getTimelineObject = () => ({

      enabledAxes: ["v1"],

      minAccelTimeByAxis: { v1: 1 },

    });

    renderPanel({

      selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" },

    });

    expect(screen.getByText("加速短于最短加减速 1000 ms")).not.toBeNull();

    expect(screen.getByText("减速短于最短加减速 1000 ms")).not.toBeNull();

  });



  it("shows insufficient-cruise warning when accel plus decel fill duration", () => {

    builderState.current.getTimelineObject = () => ({

      enabledAxes: ["v1"],

      minAccelTimeByAxis: { v1: 1 },

    });

    renderPanel({

      sequence: {

        ...sequence,

        segments: [

          {

            fromRef: "pose",

            toRef: "later",

            settings: { profiles: profiles(800, 800) },

          },

        ],

      },

      selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" },

    });

    expect(screen.getByText("时长不足，加速与减速至少各需 1000 ms")).not.toBeNull();

  });



  it("edits command enabled and atMs", () => {

    renderPanel({ selection: { kind: "block", blockId: "enable" } });

    fireEvent.click(screen.getByRole("checkbox", { name: "使能" }));

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({ id: "enable", instr: { enabled: false } }),

    );

    stepUp("时间");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({ id: "enable", atMs: 600 }),

    );

  });



  it("edits static preset registry params and reorders participants", () => {

    renderPanel({ selection: { kind: "block", blockId: "static" } });

    stepUp("v1");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({

        id: "static",

        params: expect.objectContaining({ v1: 1 }),

      }),

    );

    fireEvent.click(screen.getByRole("button", { name: "下移 8" }));

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({

        id: "static",

        orderedObjectIds: [9, 8],

      }),

    );

  });



  it("shows generated preset poses as read-only inspection rows", () => {

    renderPanel({ selection: { kind: "block", blockId: "static" } });

    const inspection = screen.getByLabelText("生成位姿");

    expect(within(inspection).queryByRole("button", { name: "增加" })).toBeNull();

    expect(within(inspection).queryByRole("checkbox")).toBeNull();

    expect(within(inspection).getAllByRole("listitem").length).toBeGreaterThan(0);

  });



  it("lists only enabledAxes on a single pose", () => {

    builderState.current.getTimelineObject = () => ({

      enabledAxes: ["v1"],

    });

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    expect(screen.getByLabelText("虚轴1")).not.toBeNull();

    expect(screen.queryByLabelText("虚轴2")).toBeNull();

    expect(screen.queryByLabelText("虚轴3")).toBeNull();

  });

});



describe("SequencePropertiesPanel multi-pose", () => {

  it("shows the multi-pose editor when every selected block is a pose", () => {

    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "later"] } });

    expect(screen.getByRole("heading", { name: "多选位姿" })).not.toBeNull();

    expect(screen.getByText("已选 2 项")).not.toBeNull();

    expect(screen.getByRole("tab", { name: "绝对" })).not.toBeNull();

    expect(screen.getByLabelText("虚轴1")).not.toBeNull();

    expect(screen.queryByLabelText("到达时间")).toBeNull();

  });



  it("keeps the count-only panel when the selection mixes kinds", () => {

    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "enable"] } });

    expect(screen.getByRole("heading", { name: "多选" })).not.toBeNull();

    expect(screen.getByText("已选 2 项")).not.toBeNull();

    expect(screen.queryByRole("heading", { name: "多选位姿" })).toBeNull();

    expect(screen.queryByRole("tab", { name: "绝对" })).toBeNull();

  });



  it("renders the union of enabledAxes across selected poses", () => {

    builderState.current.getTimelineObject = (objectId: number) =>

      objectId === 7 ? { enabledAxes: ["v1"] } : { enabledAxes: ["v2"] };

    renderPanel({

      sequence: {

        ...sequence,

        blocks: [

          { id: "pose-a", kind: "pose", objectId: 7, atMs: 100, pose: { v1: 1, v2: 0, v3: 0 } },

          { id: "pose-b", kind: "pose", objectId: 8, atMs: 200, pose: { v1: 0, v2: 2, v3: 0 } },

        ],

      },

      selection: { kind: "multi-block", blockIds: ["pose-a", "pose-b"] },

    });

    expect(screen.getByLabelText("虚轴1")).not.toBeNull();

    expect(screen.getByLabelText("虚轴2")).not.toBeNull();

    expect(screen.queryByLabelText("虚轴3")).toBeNull();

  });



  it("shows a mixed absolute value as --", () => {

    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "later"] } });

    expect(screen.getByLabelText("虚轴1").textContent).toContain("--");

  });



  it("resets the relative draft to 0 after a batch write", () => {

    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "later"] } });

    fireEvent.click(screen.getByRole("tab", { name: "相对" }));

    expect(screen.getByLabelText("虚轴1").textContent).toContain("0");

    stepUp("虚轴1");

    expect(builderState.current.handleApplyPoseAxisWrite).toHaveBeenCalledWith(

      ["pose", "later"],

      { mode: "rel", axis: "v1", value: 1 },

    );

    expect(screen.getByLabelText("虚轴1").textContent).toContain("0");

  });

});


