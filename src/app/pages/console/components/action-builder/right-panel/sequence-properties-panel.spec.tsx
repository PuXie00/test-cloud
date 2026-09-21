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
      sequenceIssues: [] as unknown[],

    },

  },

}));



vi.mock("../use-action-builder", () => ({

  useActionBuilder: () => builderState.current,

}));



const sequence: ActionSequenceConfig = {

  id: 1,

  name: "Seq",

  trajectoryMode: false,

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

  builderState.current.sequenceIssues = [];

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



  it("does not render generic swing fields on preset properties", () => {
    renderPanel({ selection: { kind: "block", blockId: "static" } });
    expect(screen.queryByLabelText("摆动 X")).toBeNull();
    expect(screen.queryByLabelText("摆动 Y")).toBeNull();
    expect(screen.queryByText("摆动 X")).toBeNull();
    expect(screen.queryByText("摆动 Y")).toBeNull();
    expect(screen.getByLabelText("升降")).not.toBeNull();

    cleanup();
    renderPanel({ selection: { kind: "block", blockId: "dynamic" } });
    expect(screen.queryByLabelText("摆动 X")).toBeNull();
    expect(screen.queryByLabelText("摆动 Y")).toBeNull();
    expect(screen.queryByText("摆动 X")).toBeNull();
    expect(screen.queryByText("摆动 Y")).toBeNull();
  });

  it("edits static preset registry params without participant reorder or pose table", () => {

    renderPanel({ selection: { kind: "block", blockId: "static" } });

    stepUp("升降");

    expect(handlers.onReplaceBlock).toHaveBeenCalledWith(

      expect.objectContaining({

        id: "static",

        params: expect.objectContaining({ v1: 1 }),

      }),

    );

    expect(screen.queryByRole("button", { name: "下移 8" })).toBeNull();

    expect(screen.queryByRole("button", { name: "上移 8" })).toBeNull();

    expect(screen.queryByLabelText("生成位姿")).toBeNull();

    expect(screen.queryByText("参与物体顺序")).toBeNull();

    expect(screen.getByText(/每物体 1 个位姿/)).not.toBeNull();

  });



  it("shows 待修复内容 when preset params put generated poses outside limits", () => {

    builderState.current.sequenceIssues = [

      {

        severity: "error",

        code: "limit-exceeded",

        message: "axis v1 position 1800 outside [0, 1000]",

        objectId: 8,

        blockId: "static",

      },

    ];

    renderPanel({ selection: { kind: "block", blockId: "static" } });

    expect(screen.getByLabelText("待修复内容")).not.toBeNull();

    expect(screen.getByText("模型 8 虚轴1 位姿 1800 超出范围 [0, 1000]")).not.toBeNull();

  });



  it("shows angle-protection copy on the matching pose", () => {

    builderState.current.sequenceIssues = [

      {

        severity: "error",

        code: "angle-protection",

        message: "当前高度 0 mm 下虚轴2 允许 [0, 0]°，实际 10°",

        objectId: 7,

        blockId: "pose",

      },

    ];

    renderPanel({ selection: { kind: "block", blockId: "pose" } });

    expect(screen.getByLabelText("待修复内容")).not.toBeNull();

    expect(screen.getByText("模型 7 当前高度 0 mm 下虚轴2 允许 [0, 0]°，实际 10°")).not.toBeNull();

  });



  it("shows motor-overspeed copy on the matching motion segment", () => {

    builderState.current.sequenceIssues = [

      {

        severity: "error",

        code: "motor-overspeed",

        message: "在 t = 1.10s 处线速度达到 558.9 mm/s，超过电机限速 500 mm/s。建议将本段时长延长至 9.17s",

        objectId: 7,

        segmentKey: "pose->later",

      },

    ];

    renderPanel({ selection: { kind: "segment", objectId: 7, fromRef: "pose", toRef: "later" } });

    expect(screen.getByLabelText("待修复内容")).not.toBeNull();

    expect(
      screen.getByText(
        "在 t = 1.10s 处线速度达到 558.9 mm/s，超过电机限速 500 mm/s。建议将本段时长延长至 9.17s",
      ),
    ).not.toBeNull();

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

  it("deletes every selected pose from the multi-pose panel", () => {
    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "later"] } });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(handlers.onDeleteBlock).toHaveBeenCalledWith(["pose", "later"]);
  });

  it("deletes a mixed multi-selection", () => {
    renderPanel({ selection: { kind: "multi-block", blockIds: ["pose", "enable"] } });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(handlers.onDeleteBlock).toHaveBeenCalledWith(["pose", "enable"]);
  });

});


