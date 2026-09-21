# C++ Action Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ready 载荷在同一份 `resolveActionSequence` 上同时带上 PLC `timelineList`、C++ `modelList`（位姿时间块 + 绝对值梯形运动学）和 `IOBlockList`（csocket 形状的指令）。

**Architecture:** `compilePlcAction` 只 resolve 一次，产出 `timelines` + `models` + `ioBlocks`。运动学只经过 `axisKinematics`；指令只经过 `instructionToCompiledEvent`。`toActionDataSaveItems` 映射为 `timelineList` / `modelList` / `IOBlockList`。不改 `actionReady` 发包。

**Tech Stack:** TypeScript, Vitest, existing `resolveActionSequence` / `calculateMotionProfileKinematics` / `roundProjectCoordinate`.

## Global Constraints

- 禁止全量 `vitest run` / `npm test` / `tsc --noEmit` / 整包 build；只跑本任务点名的文件
- 不实现 `actionReady` 实际 C++ 发包（main 仍可 log）
- 不实现三次曲线，只保留 `axisKinematics` 扩展点；未知 `kind` 抛错
- 不新增时间轴指令种类（首版仅 `set-enabled`）
- 不改 PLC `a/b/c` 三相语义；100 段上限只约束 PLC 时间轴
- C++ 时间块按解析位姿切，不按加速/匀速/减速三相切
- `vel` / `accVel` / `decVel` 都是绝对值（≥ 0）；方向由相邻 `pos` 差决定
- 中文 UI 文案（本轮无新 UI）；token 用 theme，不硬编码色值

## File map

- Modify: `shared/csocket/action-data-save.ts` — `PlcCompiledAction` 改为 `models` + `ioBlocks`
- Create: `src/app/project/action-sequence/axis-kinematics.ts` — 轮廓 → `{ vel, accVel, decVel }`
- Create: `src/app/project/action-sequence/axis-kinematics.spec.ts`
- Modify: `src/app/project/action-sequence/instruction-registry.ts` — `instructionToCompiledEvent`
- Modify: `src/app/project/action-sequence/compile-plc-action.ts` — 产出 `models` 与 `ioBlocks`
- Modify: `src/app/project/action-sequence/plc-action-payload.ts` — `modelList` / `IOBlockList`
- Modify: `src/app/pages/console/hooks/sequence-execution.ts` — `uniqueSortedModelIds`
- Test: `instruction-registry.spec.ts`, `compile-plc-action.spec.ts`, `plc-action-payload.spec.ts`, `sequence-execution.spec.ts`

---

### Task 1: `instructionToCompiledEvent`

**Files:**
- Modify: `src/app/project/action-sequence/instruction-registry.ts`
- Test: `src/app/project/action-sequence/instruction-registry.spec.ts`

**Interfaces:**
- Consumes: `InstructionBlock`（首版只有 `presetId: "set-enabled"`）
- Produces: `instructionToCompiledEvent(block: InstructionBlock): cCompiledEvent`。删除 `instructionToPlcEvent`。常量 `SET_ENABLED_OPT_CMD = "Operation|enable"`、`SET_ENABLED_ADDR = "0x0102"`。

- [ ] **Step 1: Write the failing test**

Replace the compile assertion in `src/app/project/action-sequence/instruction-registry.spec.ts` and add an unknown-preset case:

```ts
import { describe, expect, it } from "vitest";
import type { InstructionBlock } from "./types";
import {
  createSetEnabledInstruction,
  instructionBlockTitle,
  instructionToCompiledEvent,
  isInstructionPresetId,
  SET_ENABLED_ADDR,
  SET_ENABLED_OPT_CMD,
  validateInstructionInstr,
} from "./instruction-registry";

describe("instruction-registry", () => {
  it("accepts set-enabled instr and rejects extra or missing keys", () => {
    expect(isInstructionPresetId("set-enabled")).toBe(true);
    expect(isInstructionPresetId("static-flat")).toBe(false);
    expect(validateInstructionInstr("set-enabled", { enabled: true })).toEqual([]);
    expect(validateInstructionInstr("nope", { enabled: true })).toEqual(["unknown instruction nope"]);
    expect(validateInstructionInstr("set-enabled", { enabled: true, extra: 1 })).toContain(
      "unknown parameter: extra",
    );
    expect(validateInstructionInstr("set-enabled", {})).toContain("missing parameter: enabled");
  });

  it("titles and compiles set-enabled from instr.enabled", () => {
    const enable = createSetEnabledInstruction("a", 7, 100, true);
    const disable = createSetEnabledInstruction("b", 7, 200, false);
    expect(instructionBlockTitle(enable)).toBe("使能指令");
    expect(instructionBlockTitle(disable)).toBe("断使能指令");
    expect(instructionToCompiledEvent(enable)).toEqual({
      time: 100,
      params: {
        OptCmd: SET_ENABLED_OPT_CMD,
        addr: SET_ENABLED_ADDR,
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    });
    expect(instructionToCompiledEvent(disable)).toEqual({
      time: 200,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    });
  });

  it("throws when compiling an unknown instruction preset", () => {
    const block = {
      id: "x",
      kind: "instruction",
      presetId: "nope",
      objectId: 7,
      atMs: 0,
      instr: { enabled: true },
    } as InstructionBlock;
    expect(() => instructionToCompiledEvent(block)).toThrow(/cannot compile instruction nope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/action-sequence/instruction-registry.spec.ts`

Expected: FAIL — `instructionToCompiledEvent` / `SET_ENABLED_OPT_CMD` 未导出。

- [ ] **Step 3: Write minimal implementation**

In `src/app/project/action-sequence/instruction-registry.ts`, replace the `PlcCompiledEvent` import and `instructionToPlcEvent`:

```ts
import type { cCompiledEvent } from "@shared/csocket/action-data-save";
import type { InstructionBlock, SetEnabledInstruction } from "./types";

export const SET_ENABLED_OPT_CMD = "Operation|enable";
export const SET_ENABLED_ADDR = "0x0102";

export const instructionToCompiledEvent = (block: InstructionBlock): cCompiledEvent => {
  if (block.presetId !== "set-enabled") {
    throw new Error(`cannot compile instruction ${block.presetId}`);
  }
  return {
    time: block.atMs,
    params: {
      OptCmd: SET_ENABLED_OPT_CMD,
      addr: SET_ENABLED_ADDR,
      params: [{ deviceId: block.objectId, enableFlag: block.instr.enabled ? 1 : 0 }],
    },
  };
};
```

Keep `INSTRUCTION_PRESET_IDS`, `createSetEnabledInstruction`, `validateInstructionInstr`, `instructionBlockTitle` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/action-sequence/instruction-registry.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/instruction-registry.ts src/app/project/action-sequence/instruction-registry.spec.ts
git commit -m "Compile set-enabled instructions into csocket IO blocks."
```

---

### Task 2: `axisKinematics`

**Files:**
- Create: `src/app/project/action-sequence/axis-kinematics.ts`
- Test: `src/app/project/action-sequence/axis-kinematics.spec.ts`

**Interfaces:**
- Consumes: `MotionProfile`, `calculateMotionProfileKinematics`, `roundProjectCoordinate`
- Produces:

```ts
export type AxisKinematics = { vel: number; accVel: number; decVel: number };
export const ZERO_AXIS_KINEMATICS: AxisKinematics = { vel: 0, accVel: 0, decVel: 0 };
export const axisKinematics = (
  profile: MotionProfile,
  travel: number,
  durationMs: number,
): AxisKinematics;
```

`idle` 或 `travel === 0` → 全 0。`trapezoid` → 现有运动学取绝对值再 `roundProjectCoordinate`。其他 `kind` 抛 `unsupported motion profile: ${kind}`。

- [ ] **Step 1: Write the failing test**

Create `src/app/project/action-sequence/axis-kinematics.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { roundProjectCoordinate } from "../project-quantity";
import { axisKinematics, ZERO_AXIS_KINEMATICS } from "./axis-kinematics";
import { calculateMotionProfileKinematics } from "./motion-profile";
import type { MotionProfile } from "./types";

const trap = (accelMs: number, decelMs: number): MotionProfile => ({
  kind: "trapezoid",
  params: { accelMs, decelMs },
});

describe("axisKinematics", () => {
  it("returns zeros for idle or zero travel", () => {
    expect(axisKinematics({ kind: "idle" }, 100, 1000)).toEqual(ZERO_AXIS_KINEMATICS);
    expect(axisKinematics(trap(150, 250), 0, 1000)).toEqual(ZERO_AXIS_KINEMATICS);
  });

  it("emits rounded absolute trapezoid kinematics even when travel is negative", () => {
    const profile = trap(150, 250);
    const positive = calculateMotionProfileKinematics(profile, 1000, 1000);
    const expected = {
      vel: roundProjectCoordinate(Math.abs(positive.peakVelocity)),
      accVel: roundProjectCoordinate(Math.abs(positive.acceleration)),
      decVel: roundProjectCoordinate(Math.abs(positive.deceleration)),
    };
    expect(axisKinematics(profile, 1000, 1000)).toEqual(expected);
    expect(axisKinematics(profile, -1000, 1000)).toEqual(expected);
    expect(expected.vel).toBeGreaterThan(0);
    expect(expected.accVel).toBeGreaterThan(0);
    expect(expected.decVel).toBeGreaterThan(0);
  });

  it("throws on unsupported profile kinds", () => {
    const cubic = { kind: "cubic" } as unknown as MotionProfile;
    expect(() => axisKinematics(cubic, 10, 1000)).toThrow(/unsupported motion profile: cubic/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project/action-sequence/axis-kinematics.spec.ts`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write minimal implementation**

Create `src/app/project/action-sequence/axis-kinematics.ts`:

```ts
import { roundProjectCoordinate } from "../project-quantity";
import { calculateMotionProfileKinematics } from "./motion-profile";
import type { MotionProfile } from "./types";

export type AxisKinematics = {
  vel: number;
  accVel: number;
  decVel: number;
};

export const ZERO_AXIS_KINEMATICS: AxisKinematics = {
  vel: 0,
  accVel: 0,
  decVel: 0,
};

export const axisKinematics = (
  profile: MotionProfile,
  travel: number,
  durationMs: number,
): AxisKinematics => {
  if (profile.kind === "idle" || travel === 0) return ZERO_AXIS_KINEMATICS;
  if (profile.kind === "trapezoid") {
    const kinematics = calculateMotionProfileKinematics(profile, travel, durationMs);
    return {
      vel: roundProjectCoordinate(Math.abs(kinematics.peakVelocity)),
      accVel: roundProjectCoordinate(Math.abs(kinematics.acceleration)),
      decVel: roundProjectCoordinate(Math.abs(kinematics.deceleration)),
    };
  }
  throw new Error(`unsupported motion profile: ${String((profile as { kind: string }).kind)}`);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project/action-sequence/axis-kinematics.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/axis-kinematics.ts src/app/project/action-sequence/axis-kinematics.spec.ts
git commit -m "Map motion profiles to absolute vel/acc/dec for C++ time blocks."
```

---

### Task 3: Compile `ioBlocks` and empty `models`

**Files:**
- Modify: `shared/csocket/action-data-save.ts` (`PlcCompiledAction`)
- Modify: `src/app/project/action-sequence/compile-plc-action.ts`
- Modify: `src/app/project/action-sequence/plc-action-payload.ts`
- Modify: `src/app/pages/console/hooks/sequence-execution.ts` (`uniqueSortedModelIds`)
- Test: `src/app/project/action-sequence/compile-plc-action.spec.ts`
- Test: `src/app/project/action-sequence/plc-action-payload.spec.ts`
- Test: `src/app/pages/console/hooks/sequence-execution.spec.ts`

**Interfaces:**
- Consumes: `instructionToCompiledEvent`, existing PLC timeline compile
- Produces:

```ts
export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  models: cCompiledModel[]
  ioBlocks: cCompiledEvent[]
}
```

本任务 `models` 先固定 `[]`。`toActionDataSaveItems` 写 `modelList: compiled.models`、`IOBlockList: compiled.ioBlocks`，删除 `eventCount` / `eventList`。`uniqueSortedModelIds` 收集 `timelines[].modelId` 与 `ioBlocks[].params.params[].deviceId`。

- [ ] **Step 1: Write the failing tests**

In `compile-plc-action.spec.ts`, replace the two event tests:

```ts
  it("emits enableFlag io blocks", () => {
    const compiled = compilePlcAction(laterInitialSequence, threeAxisContext);
    expect(compiled.ioBlocks).toContainEqual({
      time: 500,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    });
  });

  it("compiles a command-only sequence with io blocks and no timelines or models", () => {
    const compiled = compilePlcAction(
      sequenceOf([{
        id: "enable",
        kind: "instruction",
        presetId: "set-enabled",
        objectId: 7,
        atMs: 1000,
        instr: { enabled: true },
      }]),
      threeAxisContext,
    );
    expect(compiled.timelines).toEqual([]);
    expect(compiled.models).toEqual([]);
    expect(compiled.ioBlocks).toEqual([{
      time: 1000,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    }]);
  });
```

In `plc-action-payload.spec.ts`, replace both tests' event assertions:

```ts
    expect(item).not.toHaveProperty("eventCount");
    expect(item).not.toHaveProperty("eventList");
    expect(item.modelList).toEqual(compiled.models);
    expect(item.IOBlockList).toEqual([{
      time: 500,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 0 }],
      },
    }]);
```

and for command-only:

```ts
    expect(items[0].timelineList).toEqual([]);
    expect(items[0].modelList).toEqual([]);
    expect(items[0].IOBlockList).toEqual([{
      time: 1000,
      params: {
        OptCmd: "Operation|enable",
        addr: "0x0102",
        params: [{ deviceId: 7, enableFlag: 1 }],
      },
    }]);
    expect(items[0]).not.toHaveProperty("eventList");
```

In `sequence-execution.spec.ts`, replace the command-only collector:

```ts
  it("collects command-only model IDs from io blocks and reaches saveAction", () => {
    const transport = createTransport();
    const downloaded = await downloadSequence(commandOnlySequence, context, transport);
    expect(downloaded).toMatchObject({ ok: true, modelIds: [7] });
    expect(transport.saveAction).toHaveBeenCalled();
    const compiled = compilePlcAction(commandOnlySequence, context);
    expect(compiled.timelines).toEqual([]);
    expect(compiled.ioBlocks.map((block) => block.params.params[0]?.deviceId)).toEqual([7]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
npx vitest run src/app/project/action-sequence/compile-plc-action.spec.ts src/app/project/action-sequence/plc-action-payload.spec.ts src/app/pages/console/hooks/sequence-execution.spec.ts
```

Expected: FAIL — `ioBlocks` / `models` / `IOBlockList` 不存在，或仍在读写 `events` / `eventList`。

- [ ] **Step 3: Write minimal implementation**

`shared/csocket/action-data-save.ts` 中 `PlcCompiledAction` 改为：

```ts
export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  models: cCompiledModel[]
  ioBlocks: cCompiledEvent[]
}
```

`compile-plc-action.ts`：删除 `PlcCompiledEvent` 导入；`instructionToPlcEvent` 改为 `instructionToCompiledEvent`；用下面替换 `sortEvents` 与 return：

```ts
import type { cCompiledEvent } from "@shared/csocket/action-data-save";
import { instructionToCompiledEvent } from "./instruction-registry";

const ioBlockDeviceId = (block: cCompiledEvent): number =>
  block.params.params[0]?.deviceId ?? 0;

const sortIoBlocks = (blocks: cCompiledEvent[]): cCompiledEvent[] =>
  [...blocks].sort((left, right) => {
    const timeDelta = compareNumber(left.time, right.time);
    if (timeDelta !== 0) return timeDelta;
    return compareNumber(ioBlockDeviceId(left), ioBlockDeviceId(right));
  });
```

```ts
  return {
    totalDuration: resolved.totalMs,
    timelines,
    models: [],
    ioBlocks: sortIoBlocks(resolved.commands.map(instructionToCompiledEvent)),
  };
```

`plc-action-payload.ts`:

```ts
export const toActionDataSaveItems = (
  compiled: PlcCompiledAction,
  actionId: number,
): ActionDataSaveItem[] => [
  {
    actionId,
    totalDuration: compiled.totalDuration,
    timelineCount: compiled.timelines.length,
    timelineList: compiled.timelines.map((timeline) => ({
      modelId: timeline.modelId,
      virtualAxisNo: timeline.virtualAxisNo,
      segmentCount: timeline.segments.length,
      segmentList: timeline.segments,
    })),
    modelList: compiled.models,
    IOBlockList: compiled.ioBlocks,
  },
];
```

`sequence-execution.ts` `uniqueSortedModelIds`:

```ts
const uniqueSortedModelIds = (
  compiled: ReturnType<typeof compilePlcAction>,
): number[] =>
  [
    ...new Set([
      ...compiled.timelines.map((timeline) => timeline.modelId),
      ...compiled.models.map((model) => model.deviceId),
      ...compiled.ioBlocks.flatMap((block) =>
        block.params.params.map((item) => item.deviceId),
      ),
    ]),
  ].sort((left, right) => left - right);
```

- [ ] **Step 4: Run tests to verify they pass**

Run the same three spec files as Step 2.

Expected: PASS。现有 PLC 时间轴 / 100 段用例也必须仍绿。`models` 此时全是 `[]`。

- [ ] **Step 5: Commit**

```bash
git add shared/csocket/action-data-save.ts src/app/project/action-sequence/compile-plc-action.ts src/app/project/action-sequence/compile-plc-action.spec.ts src/app/project/action-sequence/plc-action-payload.ts src/app/project/action-sequence/plc-action-payload.spec.ts src/app/pages/console/hooks/sequence-execution.ts src/app/pages/console/hooks/sequence-execution.spec.ts
git commit -m "Emit C++ IO blocks on the sequence ready payload."
```

---

### Task 4: Compile `modelList` time blocks

**Files:**
- Modify: `src/app/project/action-sequence/compile-plc-action.ts`
- Test: `src/app/project/action-sequence/compile-plc-action.spec.ts`
- Test: `src/app/pages/console/hooks/sequence-execution.spec.ts`（save item 含非空 `modelList`）

**Interfaces:**
- Consumes: `axisKinematics`, `ZERO_AXIS_KINEMATICS`, `roundProjectCoordinate`, `resolved.posesByObject` + `resolved.segments`, `object.enabledVirtualAxes`
- Produces: `compilePlcAction(...).models: cCompiledModel[]`（按 `deviceId` 升序）。每位姿一块（含 `visible: false` hold）。`virtualAxis` 只含已启用轴，顺序 v1→v2→v3。`vel/accVel/decVel` 来自**下一段**；无下一段或零行程则为 0。纯指令物体不进 `models`。

下一段匹配：`segment.objectId === modelId && segment.fromRef === pose.sourceRef && segment.toRef === nextPose.sourceRef`。

- [ ] **Step 1: Write the failing tests**

Add to `compile-plc-action.spec.ts` (keep existing PLC tests). Import `createDefaultAxisProfiles`, `axisKinematics`, and `DynamicPresetBlock` as needed:

```ts
import { createDefaultAxisProfiles } from "./motion-profile";
import { axisKinematics } from "./axis-kinematics";

  it("emits one C++ time block per pose with next-segment absolute kinematics", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 1000, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 2000, pose: { v1: 1000, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: { profiles: axisProfiles(150, 250) },
        }],
      },
    );
    const compiled = compilePlcAction(
      sequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    const expected = axisKinematics(trap(150, 250), 1000, 1000);
    expect(compiled.models).toEqual([{
      deviceId: 7,
      timeBlockList: [
        { time: 1000, virtualAxis: [{ pos: 0, ...expected }] },
        { time: 2000, virtualAxis: [{ pos: 1000, vel: 0, accVel: 0, decVel: 0 }] },
      ],
    }]);
  });

  it("omits disabled axes from C++ virtualAxis", () => {
    const compiled = compilePlcAction(
      laterInitialSequence,
      compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
    );
    expect(compiled.models[0]?.timeBlockList[0]?.virtualAxis).toHaveLength(1);
  });

  it("includes invisible wave hold poses as zero-kinematics blocks", () => {
    const wave: DynamicPresetBlock = {
      id: "wave-1",
      kind: "dynamic-preset",
      presetId: "dynamic-wave",
      startMs: 1000,
      endMs: 3000,
      orderedObjectIds: [7, 8],
      params: {
        baseV1: 1000,
        amplitude: 500,
        cycles: 1,
        direction: 1,
        staggerMs: 500,
        v2: 0,
        v3: 0,
      },
      profiles: createDefaultAxisProfiles(750),
    };
    const compiled = compilePlcAction(
      sequenceOf([wave]),
      compileContext([
        { id: 7, enabledVirtualAxes: ["v1"] as const },
        { id: 8, enabledVirtualAxes: ["v1"] as const },
      ]),
    );
    const model7 = compiled.models.find((model) => model.deviceId === 7);
    expect(model7?.timeBlockList.map((block) => block.time)).toEqual([1000, 1750, 2500, 3000]);
    expect(model7?.timeBlockList[2]?.virtualAxis).toEqual([
      { pos: 1000, vel: 0, accVel: 0, decVel: 0 },
    ]);
    expect(model7?.timeBlockList[3]?.virtualAxis).toEqual([
      { pos: 1000, vel: 0, accVel: 0, decVel: 0 },
    ]);
    const model8 = compiled.models.find((model) => model.deviceId === 8);
    expect(model8?.timeBlockList[0]).toEqual({
      time: 1000,
      virtualAxis: [{ pos: 1000, vel: 0, accVel: 0, decVel: 0 }],
    });
  });

  it("throws when compiling an unsupported C++ motion profile", () => {
    const sequence = sequenceOf(
      [
        { id: "start", kind: "pose", objectId: 7, atMs: 0, pose: origin },
        { id: "end", kind: "pose", objectId: 7, atMs: 1000, pose: { v1: 10, v2: 0, v3: 0 } },
      ],
      {
        segments: [{
          fromRef: "start",
          toRef: "end",
          settings: {
            profiles: {
              v1: { kind: "cubic" } as unknown as MotionProfile,
              v2: { kind: "idle" },
              v3: { kind: "idle" },
            },
          },
        }],
      },
    );
    expect(() =>
      compilePlcAction(
        sequence,
        compileContext([{ id: 7, enabledVirtualAxes: ["v1"] as const }]),
      ),
    ).toThrow(/unsupported motion profile: cubic/);
  });
```

Add import `type { DynamicPresetBlock, ... MotionProfile }` (file already imports `MotionProfile`).

In `sequence-execution.spec.ts` `passes compiled save items...` 增加：

```ts
    expect(expected[0]?.modelList.length).toBeGreaterThan(0);
    expect(expected[0]?.IOBlockList).toEqual([]);
```

`validSequence` 只有一个位姿、无指令，所以 `modelList` 非空、`IOBlockList` 为空。

- [ ] **Step 2: Run tests to verify they fail**

Run:

```
npx vitest run src/app/project/action-sequence/compile-plc-action.spec.ts src/app/pages/console/hooks/sequence-execution.spec.ts
```

Expected: FAIL — `models` 仍是 `[]`。

- [ ] **Step 3: Write minimal implementation**

In `compile-plc-action.ts` add imports and `compileModels`:

```ts
import type { cCompiledEvent, cCompiledModel } from "@shared/csocket/action-data-save";
import { roundProjectCoordinate } from "../project-quantity";
import { axisKinematics, ZERO_AXIS_KINEMATICS } from "./axis-kinematics";
import type { ResolvedActionSequence, ResolvedPosePoint } from "./resolve-sequence";
```

```ts
const AXES: VirtualAxisId[] = ["v1", "v2", "v3"];

const compileModels = (
  resolved: ResolvedActionSequence,
  objectById: Map<number, PlcCompileObject>,
): cCompiledModel[] =>
  [...resolved.posesByObject.entries()]
    .sort((left, right) => compareNumber(left[0], right[0]))
    .flatMap(([deviceId, poses]) => {
      const object = objectById.get(deviceId);
      if (!object || poses.length === 0) return [];
      const enabledAxes = AXES.filter((axis) => object.enabledVirtualAxes.includes(axis));
      const objectSegments = resolved.segments.filter((segment) => segment.objectId === deviceId);
      const timeBlockList = poses.map((pose: ResolvedPosePoint, index) => {
        const next = poses[index + 1];
        const segment = next
          ? objectSegments.find(
              (item) => item.fromRef === pose.sourceRef && item.toRef === next.sourceRef,
            )
          : undefined;
        return {
          time: pose.atMs,
          virtualAxis: enabledAxes.map((axis) => {
            const pos = roundProjectCoordinate(pose.pose[axis]);
            if (!segment) return { pos, ...ZERO_AXIS_KINEMATICS };
            const travel = segment.toPose[axis] - segment.fromPose[axis];
            return {
              pos,
              ...axisKinematics(segment.settings.profiles[axis], travel, segment.durationMs),
            };
          }),
        };
      });
      return [{ deviceId, timeBlockList }];
    });
```

Replace `models: []` with `models: compileModels(resolved, objectById)`.

Do not change PLC timeline generation.

- [ ] **Step 4: Run tests to verify they pass**

Run the same two spec files as Step 2.

Expected: PASS。PLC 三相 / 100 段用例仍绿。纯指令 `models === []` 仍绿。

- [ ] **Step 5: Commit**

```bash
git add src/app/project/action-sequence/compile-plc-action.ts src/app/project/action-sequence/compile-plc-action.spec.ts src/app/pages/console/hooks/sequence-execution.spec.ts
git commit -m "Compile C++ model time blocks from resolved poses."
```

---

## Self-review

1. Spec coverage: IO 形状 / OptCmd+addr → Task 1；绝对值运动学扩展点 → Task 2；`PlcCompiledAction` + 载荷字段 + modelIds → Task 3；位姿切块 / hold / 启用轴 / 未知轮廓 → Task 4。Non-goals 在 Global Constraints。
2. 无 TBD / “similar to Task N”。
3. 名称一致：`instructionToCompiledEvent`、`axisKinematics`、`ioBlocks`、`modelList`、`IOBlockList`。
