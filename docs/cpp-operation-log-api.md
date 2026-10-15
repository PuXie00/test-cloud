# 操作日志与报警记录：C++ 接口说明

对应需求「11.3 操作日志与报警记录」：统一时间线记录操作、报警和状态变化，核心用于异常回溯。

- **职责：** 日志由 C++ 写入、存储、查询，界面只读。界面自己产生的事件（如保存工程）调用 `Log|write` 交给 C++ 写。
- **生命周期：** 日志按工程独立。打开工程（`CONFIG|Pro|open`）开始记录，关闭工程结束，每个工程的日志文件互不相干。下面所有查询都只针对**当前打开的工程**。
- **前端现状：** 已按本文接好。C++ 未实现前由 `electron/main/cSocket/api.ts` 返回 mock（`operation-log-mock.ts`）；接口实现后把每个 `log*` 方法里的 `sendBuilt` 行放开、删掉 mock 那几行，界面不用改。

| 前端位置 | 用到的接口 |
|---|---|
| 头部菜单 →「操作日志与回放」弹窗：统一时间线、多维筛选、报警回看、趋势分析 | `Log\|query`、`Log\|filterOptions`、`Log\|alarmReview` |
| 控制页右侧「日志」：本工程最新 30 条；底部状态栏时间左侧：最新一条 | 推送 `Info\|log`（打开工程后列表为空，只靠推送追加；不显示操作人） |
| 保存工程 / 工程另存为（结果成功或失败） | `Log\|write` |

## 基本约定

沿用现有 WebSocket 报文格式，不新增字段：

- 请求：`{ version, timestamp, messageId, projectId, user, OptCmd, addr, params }`，`addr` 固定为空串（C++ 自己处理，不下发 PLC），`params` 为数组。
- 应答：`result: { success, code?, message?, data: [...] }`，`data` 始终是数组；失败时 `success: false` 并给 `message`，前端直接显示。没有打开工程时请返回失败并说明原因。
- 时间统一为毫秒时间戳（本机时钟）。
- 单位：直线轴位置 mm、速度 mm/s；旋转轴位置 °、速度 °/s（用 `unit` 区分）；转矩为额定转矩的百分比；温度 ℃。前端按「显示单位」设置自行换算。

| OptCmd | 方向 | 用途 |
|---|---|---|
| `Info\|log` | C++ → 前端（主动推送） | 新写入的日志 |
| `Log\|query` | 前端 → C++ | 多维筛选 + 分页查询当前工程日志 |
| `Log\|filterOptions` | 前端 → C++ | 筛选下拉框的可选值 |
| `Log\|alarmReview` | 前端 → C++ | 一条报警的状态快照（前 10s + 后 5s 曲线）及该时段的记录 |
| `Log\|write` | 前端 → C++ | 界面侧事件交给 C++ 写入 |

## C++ 需要记录什么

日志面向用户可感知的内容。系统内部报错、底层通讯细节等用户无感的内容用 `debug` 级别记录，前端默认隐藏（筛选「日志级别」选「调试」或「全部（含调试）」才显示），也可以视情况只写模块 15 系统日志。

| 内容 | `category` / `opGroup` | 说明 |
|---|---|---|
| 配置操作 | `operation` / `config` | 保存工程（界面经 `Log\|write` 写）、下载工程等，记录操作内容和结果 |
| 设备操作 | `operation` / `device` | 耦合 / 解耦、启动 / 停止、使能 / 禁用、点动、执行动作序列等，记录操作内容和结果 |
| 设备调试 | `operation` / `debug` | 点动、设定原点、规则引擎修改等，记录操作内容和结果 |
| 设备报警 | `alarm` | 发生记一条 `alarmState: "raised"`，清除再记一条 `"cleared"`；含报警码、报警描述（`message`）、报警级别 |
| 状态快照 | 挂在报警记录上 | 只有报警才有快照，见下方「状态快照机制」 |
| 状态变化 / 内部细节 | `system` | 主控连接断开、工程校验结果等用 info / warning；内部细节用 debug |

**多设备：** 一条指令一条日志，不按设备拆。指令涉及的设备都放进 `devices`，多设备执行结果不一致时在每台设备上标 `ok`，整体结果放 `result`（例如 3 台成功 1 台失败：`result.ok = false`，`message` 写明哪台失败）。

**`opType` 建议取值**（mock 里用的；可扩展，显示名由 `Log|filterOptions` 返回，前端不写死；同一个 `opType` 可以出现在不同分组，例如点动）：

| opGroup | opType | 显示名 | 对应命令 |
|---|---|---|---|
| config | `saveProject` | 保存工程 | 界面 `Log\|write` |
| config | `saveProjectAs` | 工程另存为 | 界面 `Log\|write` |
| config | `downloadProject` | 下载工程 | `CONFIG\|Pro\|download` |
| device | `couple` | 耦合 / 解耦 | `Opera\|couple` |
| device | `enable` | 使能 / 禁用 | `Opera\|enable`（物体） |
| device | `jog` | 点动 | `Opera\|jog`（物体 0x0104） |
| device | `moveTarget` | 启动（目标位置） | `Opera\|moveTarget` |
| device | `stop` | 停止 | `Opera\|stop`、`Opera\|syncMoveEnd`、`Opera\|actionCall` |
| device | `eStop` | 急停 | `Opera\|eStop`、`Opera\|AllStop` |
| device | `sequence` | 执行动作序列 | `Opera\|syncMovebegin`、`Opera\|actionSyncRelease` |
| debug | `jog` | 点动 | `Opera\|jog`（电机 0x0006） |
| debug | `setOrigin` | 设定原点 | `Opera\|setPosition` |
| debug | `ruleEdit` | 规则引擎修改 | 规则相关命令 |

### 状态快照机制

```
C++ 维护一个 10s 的环形缓冲区，持续缓存设备状态（建议 100ms 采样）：
  - 正常运行无报警 → 缓存自动丢弃，不写日志
  - 报警发生 → 立即把缓冲区里报警前 10s 的数据写入日志
            → 继续记录报警后 5s，一并写入
  - 每个采样点：位置、速度、转矩、温度（没有的量可省略）
```

报警记录上带 `snapshotRange: { start, end }`（报警前 10s ~ 后 5s），前端据此在时间线「快照」行画出这段时间，并只对带快照的报警开放回看。报警后 5s 还没写完时，`Log|alarmReview` 返回已有的部分即可。

## 数据结构

类型定义在 `shared/csocket/operation-log.ts`。

### LogRecord（一条日志）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 全局唯一 |
| `timestamp` | number | 是 | 毫秒时间戳 |
| `category` | `"operation"` \| `"alarm"` \| `"system"` | 是 | 类别 |
| `level` | `"debug"` \| `"info"` \| `"warning"` \| `"error"` | 是 | 日志级别，debug 默认隐藏 |
| `message` | string | 是 | 展示文案；报警时为报警描述 |
| `user` | string | 操作类必填 | 操作人，取报文里的 `user` |
| `devices` | LogDevice[] | 否 | 涉及的设备，可多台 |
| `opGroup` | `"config"` \| `"device"` \| `"debug"` | 操作类必填 | 配置操作 / 设备操作 / 设备调试 |
| `opType` | string | 操作类必填 | 操作类型编码 |
| `result` | `{ ok: boolean, message?: string }` | 操作类必填 | 操作结果；失败时 `message` 写原因 |
| `alarmLevel` | `1` \| `2` \| `3` | 报警类必填 | 1 一般 / 2 严重 / 3 紧急 |
| `alarmCode` | number | 报警类必填 | 报警码 |
| `alarmState` | `"raised"` \| `"cleared"` | 报警类必填 | 发生 / 清除 |
| `snapshotRange` | `{ start: number, end: number }` | 有快照的报警必填 | 快照覆盖的时间段 |

LogDevice：`deviceType`（`"plc"` / `"axis"` / `"model"`，即主控 / 电机 / 物体，与 `Info|plc` / `Info|axis` / `Info|model` 对应）、`deviceId`、`deviceName`（记录当时的名字，设备删除后仍能显示）、`ok?`（该设备的执行结果）。

### LogSnapshotSeries（一台设备在快照时段内的曲线）

| 字段 | 类型 | 说明 |
|---|---|---|
| `deviceType` / `deviceId` / `deviceName` | | 同上 |
| `unit` | `"mm"` \| `"°"` | 位置单位，缺省 mm |
| `points` | `{ t, position?, speed?, torque?, temperature? }[]` | 时间升序 |

---

## Info|log：新日志推送

C++ 每写入一条日志就主动推送（可以合并成一批），包括界面经 `Log|write` 写入的。前端按 `id` 去重后追加到控制页列表，只保留最新 30 条，最新一条显示在状态栏。`debug` 级别的不用推（推了前端也会过滤掉）。

```json
{ "OptCmd": "Info|log", "result": { "success": true, "data": [ /* LogRecord */ ] } }
```

## Log|query：日志查询

```json
"params": [{
  "startTime": 1791860000000,
  "endTime": 1791863600000,
  "categories": ["operation", "alarm", "system"],
  "users": ["管理员"],
  "devices": [{ "deviceType": "axis", "deviceId": 3 }],
  "opGroups": ["device"],
  "opTypes": ["jog"],
  "alarmLevels": [2, 3],
  "logLevels": ["info", "warning", "error"],
  "order": "desc",
  "offset": 50,
  "limit": 50
}]
```

所有筛选字段都可缺省，缺省或空数组表示不限。前端默认会带 `logLevels: ["info","warning","error"]`（不含 debug）。`order` 缺省 `asc`；`offset` / `limit` 按 `order` 的方向计算，返回的 `records` 也按 `order` 排序。

**分页：** 前端按页取，最新的在第一页：`order` 固定 `desc`，`limit` = 每页条数（50 / 100 / 500，默认 50），`offset` = 页码（从 0 开始）× 每页条数。上面的示例是每页 50 条的第 2 页。翻页时其余参数不变，包括 `startTime` / `endTime`：用"最近 15 分钟"这类相对时间时，前端在改筛选或刷新时才重新计算时间，翻页沿用同一个时间范围。

筛选语义（各维度之间为“且”，请保持一致，前端时间线依赖它）：

- `startTime` / `endTime`：闭区间，作用于所有记录。
- `categories`、`logLevels`：作用于所有记录。
- `users`、`opGroups`、`opTypes`：**只约束操作类**，报警和系统记录不受影响。这样筛某个人或某类操作时，报警仍留在时间线上，便于看因果。
- `alarmLevels`：**只约束报警类**。
- `devices`：只约束带 `devices` 的记录，涉及的设备中**任一**命中即可；不带设备的记录不受影响。

```json
"result": { "success": true, "data": [{ "total": 343, "records": [ /* LogRecord */ ] }] }
```

`total` 为满足条件的总条数（不受 `offset` / `limit` 影响），前端用它算总页数，请保证准确。`offset` 超出总数时返回空的 `records`、`total` 照常给出，前端会退回到最后一页。

## Log|filterOptions：筛选项

返回当前工程日志里实际出现过的取值。

```json
"params": []
```

```json
"result": { "success": true, "data": [{
  "users": ["管理员", "操作员-01"],
  "devices": [{ "deviceType": "model", "deviceId": 101, "deviceName": "升降灯架-01" }],
  "opTypes": [
    { "group": "device", "code": "jog", "label": "点动" },
    { "group": "debug", "code": "jog", "label": "点动" }
  ],
  "timeRange": { "start": 1791860000000, "end": 1791862400000 }
}] }
```

`timeRange` 为最早 / 最晚一条记录的时间，没有记录时为 `null`。

## Log|alarmReview：报警回看

点击带快照的报警记录时调用，一次返回回看所需的全部数据：快照曲线（用于状态快照表和转矩 / 位置 / 速度趋势图）和该时段内的记录（用于分析操作与报警的因果）。

```json
"params": [{ "alarmId": "log-00123" }]
```

```json
"result": { "success": true, "data": [{
  "alarm": { /* LogRecord */ },
  "range": { "start": 1791861224567, "end": 1791861239567 },
  "records": [ /* range 内的操作 / 报警 / 系统记录（含 debug），时间升序，含 alarm 本身 */ ],
  "snapshot": [{
    "deviceType": "axis", "deviceId": 3, "deviceName": "电机-03", "unit": "mm",
    "points": [{ "t": 1791861224567, "position": 6012.3, "speed": 35.2, "torque": 41.8, "temperature": 42.0 }]
  }]
}] }
```

- `range` 即报警记录的 `snapshotRange`。
- `snapshot` 每台设备一条，建议包含缓冲区里的全部运动设备；同一报警里各设备的采样时刻尽量对齐。前端默认画报警设备和报警前操作过的设备（最多 3 台），用户可以切换。
- 报警不存在或没有快照时返回 `success: false`，`message` 如「该报警没有状态快照」。

## Log|write：界面写日志

界面自己产生、C++ 看不到的事件交给 C++ 写入当前工程日志。C++ 补上 `id`、`user`（取报文里的 `user`），写完后照常 `Info|log` 推送。

```json
"params": [{
  "category": "operation",
  "level": "warning",
  "opGroup": "config",
  "opType": "saveProject",
  "message": "保存工程「演示工程」",
  "result": { "ok": false, "message": "磁盘空间不足" },
  "timestamp": 1791861234567
}]
```

`category` 只能是 `operation` 或 `system`；`timestamp` 为事件发生时间，缺省用 C++ 收到的时间。应答 `data` 返回写入后的 LogRecord。

目前界面会写的：保存工程、工程另存为（成功和失败都写）。规则编辑器还没有接 C++，接好后「规则引擎修改」也走这里或由 C++ 直接记录。

---

## 前端还需要配合的一点

报文里的 `user` 来自 `csocketApi.configure({ user })`，目前前端还没有调用它，所以 C++ 收到的命令都没有操作人。要做「按用户筛选」，需要前端在登录后把当前用户名配置进去。
