# Traveling wave chase poses

Date: 2026-09-19

## Problem

行进波浪已改成错相起伏，但解析仍把每个物体的第一点钉在块 `startMs`、最后一点钉在 `endMs`。晚启动的物体因此在块头、块尾多出「等在基准上」的点，一个周期变成 4 个可见位姿。曲线编辑器应对的是升/降半程，多出来的等待点会干扰位姿计数和预览。

## Decision

可见关键帧只排周期上的 **基准 → 波峰 → 基准**。周期数大于 1 时中间基准共用。块在每条参与轨上仍占满 `[startMs, endMs]`，头尾等待不打点，用隐式 idle 占住时间，避免邻段把运动拉进空档。

## Visible poses

每个参与物体 `i`（正向时 `staggerIndex = i`，反向时 `N - 1 - i`）：

- `delayMs = staggerIndex * staggerMs`
- `motionStart = startMs + delayMs`
- `motionMs = (endMs - startMs) - (N - 1) * staggerMs`
- `phaseMs = motionMs / (2 * cycles)`（`cycles` 为正整数）
- 第一点：`motionStart`，`v1 = baseV1`
- 每个周期 `c = 0 .. cycles-1`：
  - 波峰：`motionStart + (2c + 1) * phaseMs`，`v1 = baseV1 + amplitude`
  - 回基准：`motionStart + (2c + 2) * phaseMs`，`v1 = baseV1`

因此 1 个周期 3 个点；2 个周期 5 个点（`1 + 2 * cycles`）。不在 `startMs` / `endMs` 额外打基准点。最后一个物体的回基准落在 `endMs`；更早的物体最后一点早于 `endMs`。

时间块 UI 仍按 `[startMs, endMs]` 画在每条参与轨上。`generatedAtMs` 只含上面这些可见点。

## Contract

放宽动态预设契约（`dynamic-level` 仍自然满足旧等式）：

- 每物体至少 2 个点，时间严格递增
- 该物体第一点 `>= startMs`，最后一点 `<= endMs`
- 错相间隔必须让 `motionMs > 0` 且 `phaseMs > 0`

不再要求每个物体第一点等于 `startMs`、最后一点等于 `endMs`。

## Implicit idle and neighbors

等待段不出现在时间轴 tick 上，也不计入「每物体 N 个位姿」。

解析层在块边界为每个参与物体补 **不可编辑、不打 tick** 的 hold，只用于评估和接线：

- `startMs`：值为该物体块前最后一条位姿；没有则用第一可见点（基准）
- `endMs`：值为最后一条可见点（基准）

可见点仍是周期上的基准/波峰/基准。邻接可配置段接到这两条边界 hold：前一段在 `startMs` 结束，后一段从 `endMs` 开始，插值不穿过等待空档。等待期内保持块前位姿；第一可见点是基准。若块前位姿不等于 `baseV1`，在第一可见点允许跳变，沿用 `boundary-discontinuity` 警告。

重叠检测仍用整块 `[startMs, endMs]`：空档算浪的一部分，不能再插别的位姿。

零位移内部段（边界 hold、等待、以及 `v2`/`v3`）继续同步成 `idle`，避免把块级梯形套进短等待导致预览抛错。

## Curve editor

`dynamicPresetProfileDurationMs` 仍是半程 `phaseMs`（一段升或一段降）。峰值行程取相邻可见点的最大 `|Δv1|`（即 `|amplitude|`）。插入波浪时默认梯形按 `phaseMs` 和最短加减速来。

## Params

保持：`baseV1`、`amplitude`、`staggerMs`、`cycles`、`direction`。遗留 `sampleIntervalMs` / `intervalDeg` 仍忽略。

## Tests

- 1 周期两点物体：每物体恰好 3 个**可见**点；晚启动物体第一可见点 `> startMs`，早结束物体最后可见点 `< endMs`
- 2 周期：每物体 5 个可见点，中间点为共用基准
- 时间轴 `generatedAtMs` 不含块头/块尾 hold
- 拉长块 100ms 后仍无余数黄块；可见点均分在新的 `motionMs` 里
- 解析：边界 hold 与等待为 idle、升/降为共享梯形；邻段接到 `startMs`/`endMs` hold，不跨进等待空档
- 评估：等待期内保持块前位姿；波峰时刻到位；回基准后到 `endMs` 保持基准
- `fitPresetParams` 生成的块通过校验

## Non-goals

- 不恢复正弦密采样
- 不改 PLC 梯形三相格式
- 不把「水平升降」改成也可以不贴边界（它仍发两点贴在头尾）
- 不做连续正弦下发
