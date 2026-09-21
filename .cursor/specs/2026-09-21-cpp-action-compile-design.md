# C++ action compile (`modelList` / `IOBlockList`)

Date: 2026-09-21

## Problem

Ready 载荷已同时服务 PLC 与 C++，但编译只产出 PLC 多项式时间轴，并把指令编成旧的 `{ modelId, atTime, enableFlag }`。C++ 需要按物体切的时间块（位置 + 梯形速度/加减速），以及可按 csocket 重放的 IO 块（`OptCmd` / `addr` / 参数数组）。两套产物必须来自同一份解析结果，否则保持段和指令时序会对不齐。

## Decision

一次 `resolveActionSequence`，一次 `compilePlcAction`，同时产出：

- `timelines`：现有 PLC 曲线（语义不变）
- `models`：`cCompiledModel[]`（C++ 运动）
- `ioBlocks`：`cCompiledEvent[]`（C++ IO，取代 `events`）

`toActionDataSaveItems` 填入 `timelineList` / `modelList` / `IOBlockList`。本轮不改 `actionReady` 发包。

运动学只经过 `axisKinematics`。本轮实现 `idle` 与 `trapezoid`；以后三次曲线在同一函数里压成等效梯形，C++ 字段不改。未知 `kind` 抛错。

## Architecture

下载路径不变：`downloadSequence` → `compilePlcAction` → `toActionDataSaveItems` → `saveAction`。

```
ActionSequenceConfig
        │
        ▼
validateActionSequence ── blocking ──► 校验失败返回
        │
        ▼
resolveActionSequence   （只跑一次）
        │
        ├─► PLC timelines（现有 trapezoidToCurveSegments）
        ├─► C++ models（posesByObject → timeBlockList）
        └─► C++ ioBlocks（commands → instructionToCompiledEvent）
        │
        ▼
ActionDataSaveItem
  timelineList   PLC
  modelList      C++
  IOBlockList    C++
```

`PlcCompiledAction` 改为：

```ts
export type PlcCompiledAction = {
  totalDuration: number
  timelines: PlcCompiledTimeline[]
  models: cCompiledModel[]
  ioBlocks: cCompiledEvent[]
}
```

删除编译产物上的 `events`。线类型 `cCompiledEvent` / `cCompiledModel` / `ActionDataSaveItem` 以 `shared/csocket/action-data-save.ts` 为准；载荷侧删除 `eventCount` / `eventList`。

`uniqueSortedModelIds` 收集：

- `timelines[].modelId`
- `models[].deviceId`
- `ioBlocks[].params.params[].deviceId`

## `axisKinematics`

签名：`(profile, travel, durationMs) => { vel, accVel, decVel }`。三者都是绝对值（≥ 0）。运动方向由相邻时间块的 `pos` 差决定。

| 轮廓 | 结果 |
|---|---|
| `idle` 或 `travel === 0` | `{ vel: 0, accVel: 0, decVel: 0 }` |
| `trapezoid` | `calculateMotionProfileKinematics` 的 `peakVelocity` / `acceleration` / `deceleration` 取绝对值 |
| 其他 `kind` | 抛错 |

以后三次曲线只改此函数，切块规则不动。单位与现有运动学一致：位置工程单位 / 秒、位置工程单位 / 秒²。`time` 与 PLC `startTime` 一样用毫秒。`pos` 与 `vel` / `accVel` / `decVel` 均走与 PLC 系数相同的 `roundProjectCoordinate`。

## `modelList`

- 每个在 `posesByObject` 中有位姿的物体一条 `cCompiledModel`，`deviceId` 为物体 id，按 id 升序。
- 纯指令、无位姿的物体不进 `modelList`。
- `timeBlockList`：该物体每一个解析位姿一块（含界面不可见的边界/等待 hold），按 `time` 升序。
- 每一块：
  - `time` = `pose.atMs`
  - `virtualAxis` 只含已启用轴，顺序 v1 → v2 → v3（结构无轴号；C++ 按该物体已启用轴顺序对槽）
  - `pos` = 该时刻该轴位姿
  - `vel` / `accVel` / `decVel` = **下一段**该轴的 `axisKinematics`
  - 无下一段，或下一段 idle / 零行程：三项为 0
- C++ 用相邻两块插梯形：时长 = `t[i+1] - t[i]`，方向 = `pos[i+1] - pos[i]`。

PLC `timelineList` 仍按轴输出三相多项式，未启用轴整轴省略。100 段上限只约束 PLC 时间轴，不约束 `timeBlockList`。

## `IOBlockList`

`resolved.commands` 经 `instructionToCompiledEvent` 映射，按 `time` 升序，相同时间再按 `params.params[0].deviceId` 升序。

`cCompiledEvent.params.params` 的类型以 `shared/csocket/action-data-save.ts` 为准：

```ts
params: ({ deviceId: number } & Record<string, number>)[]
```

每条指令至少带 `deviceId`；其余字段必须是 `number`（使能用 `0 | 1`，不发 boolean / string / 嵌套对象）。

首版仅 `set-enabled`：

```ts
{
  time: block.atMs,
  params: {
    OptCmd: "Operation|enable",
    addr: "0x0102",
    params: [{ deviceId: block.objectId, enableFlag: block.instr.enabled ? 1 : 0 }],
  },
}
```

`enableFlag` 为 `0 | 1`。未知 `presetId` 抛错。新指令只在该映射表增加 `OptCmd` / `addr` / `params` 形状，不改切块。

## Errors

校验失败：现有校验结果，不编译。

编译抛错（PLC 段数 > 100、未知轮廓、未知指令）：`downloadSequence` 仍返回 `invalid-preset`，「动作序列无法编译」。

## Tests

只跑点名文件，禁止全量 `vitest` / `tsc` / build。

`compile-plc-action.spec.ts`

- 现有 PLC 时间轴、三相时刻、100 段上限保持
- 两位姿 + 梯形：`models` 两块；第一块运动学为下一段绝对值；最后一块为 0
- 不可见保持点也出块，运动学为 0
- 只启用 v1：`virtualAxis.length === 1`
- 纯指令：`models === []`，`ioBlocks` 有使能块
- 未知轮廓：抛错

`instruction-registry.spec.ts`

- `set-enabled` → `Operation|enable` / `0x0102` / `{ deviceId, enableFlag }`
- 未知 preset 仍抛错

`plc-action-payload.spec.ts`

- 含 `modelList`、`IOBlockList`
- 无 `eventList` / `eventCount`

`sequence-execution.spec.ts`

- `saveAction` 的 item 含 `modelList` 与 `IOBlockList`
- `modelIds` 能从 IO 块的 `deviceId` 收集

## Non-goals

- 不实现 `actionReady` 实际 C++ 发包（main 仍可 log）
- 不实现三次曲线，只保留 `axisKinematics` 扩展点
- 不新增时间轴指令种类
- 不改 PLC `a/b/c` 三相语义
- 不把 C++ 时间块改成按加速/匀速/减速三相切
- 不把 `vel` / `accVel` / `decVel` 编成带行程方向的符号量
