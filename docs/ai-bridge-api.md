# 本地 AI 接口说明

舞台控制软件运行时，会在本机启动一个 HTTP 服务，供本地 AI 获取三类信息：

1. 用户正在看什么、选了什么 → `GET /api/view`
2. 当前工程配置 → `GET /api/config`
3. 设备和动作的实时状态 → `GET /api/status`

以及唯一的写入接口：

4. 新增或修改动作序列 → `POST /api/sequences`（只改工程里的序列，不会让设备动作）

## 基本约定

| 项 | 说明 |
|---|---|
| 地址 | `http://127.0.0.1:17890`（启动软件时可用环境变量 `YZ_AI_HTTP_PORT` 改端口） |
| 方法 | 读接口只支持 `GET` / `HEAD`；写接口只有 `POST /api/sequences`。没有任何控制接口，AI 不能通过它操作设备 |
| 格式 | JSON，UTF-8 编码 |
| Host | 必须是 `127.0.0.1:<端口>`、`localhost:<端口>`、`[::1]:<端口>` 或局域网私有地址（`10.x`、`172.16~31.x`、`192.168.x`、`169.254.x`）加端口，否则返回 403。正常的 HTTP 客户端会自动带上，不用额外设置。服务监听所有网卡，同一局域网的机器也能访问（包括写接口），没有令牌 |
| 跨域 | 不支持，浏览器网页无法直接读取 |
| 单位 | 数值始终使用工程标准单位：长度 mm、速度 mm/s、加速度 mm/s²、角度 °，**不受**软件"系统设置 → 显示单位"影响。详见下方"单位"一节 |
| 可用时间 | 只在软件运行期间可用；连接被拒绝说明软件没有启动 |

### 公共字段

除 `/api/health` 外，每个响应都带：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | number | 数据版本号，内容变化时递增 |
| `updatedAt` | number | 最近一次变化的时间（毫秒时间戳） |

### 缓存与轮询

每个响应都带 `ETag` 头。轮询时把上次的 ETag 放进 `If-None-Match`，数据没变就返回 `304`，响应体为空：

```bash
curl -s -i -H 'If-None-Match: "s5-1he80nc"' http://127.0.0.1:17890/api/status
```

数据是软件推给服务的内存快照，请求不会打扰界面和控制逻辑。延迟大致为：界面状态约 50ms，配置在修改停止约 300ms 后更新，设备状态约 100ms。

### 错误

```json
{ "ok": false, "code": "NOT_FOUND", "message": "unknown path /api/xxx" }
```

| HTTP 状态 | code | 原因 |
|---|---|---|
| 403 | `FORBIDDEN_HOST` | Host 不是本机地址 |
| 404 | `NOT_FOUND` | 路径不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 读接口用了 GET / HEAD 以外的方法，或写接口没用 POST |

写接口另有自己的错误码，见 `POST /api/sequences` 一节。

---

## GET /api/health

用于存活检查。

```json
{
  "ok": true,
  "pid": 176577,
  "uptimeMs": 15410,
  "rendererConnected": true,
  "versions": { "view": 2, "config": 2, "status": 5 }
}
```

`rendererConnected` 为 `false` 表示界面还没连上（比如软件刚启动或正在刷新），这时 `/api/view` 和 `/api/config` 会暂时为空。

---

## GET /api/view：用户在看什么、选了什么

### 示例

```json
{
  "version": 9,
  "updatedAt": 1791604218450,
  "rendererConnected": true,
  "page": "console",
  "path": "/console",
  "ruleId": null,
  "project": { "id": "gz-2025", "name": "2025广州演唱会", "folderName": "2025广州演唱会", "dirty": false },
  "console": {
    "mode": "rehearsal",
    "nav": "sequences",
    "tab": "selection",
    "selection": {
      "objects": [
        { "id": 9, "name": "升降灯架-01" },
        { "id": 10, "name": "升降摆动架-01" }
      ],
      "primaryObjectId": 9,
      "motors": [],
      "treeFocus": null,
      "sequence": { "id": 1, "name": "新建动作序列" }
    }
  }
}
```

### 字段

| 字段 | 说明 |
|---|---|
| `page` | `login` 登录页 / `project-center` 工程中心 / `console` 控制台 / `rule-editor` 规则编辑 / `other`；界面未连上时为 `null` |
| `path` | 界面路由路径 |
| `ruleId` | 在规则编辑页时为当前规则 id，否则为 `null` |
| `project` | 当前打开的工程；没打开时为 `null` |
| `project.dirty` | `true` 表示有未保存的修改 |
| `console` | 只在控制台页面有值，否则为 `null` |
| `console.mode` | `rehearsal` 排练 / `show` 演出 |
| `console.nav` | 左侧导航：`control` 控制 / `devices` 搭建 / `sequences` 动作。演出模式下固定为 `control` |
| `console.tab` | 当前导航下右侧面板的 Tab，见下表 |
| `selection.objects` | 选中的受控物体（即 C++ 协议里的 model），包含 id 和名称 |
| `selection.primaryObjectId` | 主选物体 id；没有时为 `null` |
| `selection.motors` | 选中的电机 |
| `selection.treeFocus` | 工程结构树聚焦的项：`{ kind, id, name }`，`kind` 为 `controlled-object` / `master`（PLC） / `motor`，没有时为 `null` |
| `selection.sequence` | 动作页时间轴编辑器里选中的动作序列；没有时为 `null` |

`console.tab` 的取值：

| nav | tab 取值 |
|---|---|
| `control` | `manual` 手动控制 / `program` 节目 / `log` 日志 / `detail` 详情；右侧面板隐藏时为 `null`；演出模式没有 `manual` |
| `devices` | `structure` 工程结构 / `debug` 调试 / `wizard` 配置向导 / `rules` 规则 |
| `sequences` | `selection` 属性 / `program` 节目管理 |

---

## GET /api/config：当前工程配置

返回软件内存里的配置，**包含尚未保存的修改**。没有打开工程时 `config` 为 `null`。

### 参数

| 参数 | 说明 |
|---|---|
| `sections` | 只返回指定分区，逗号分隔：`meta`、`setup`、`motion`、`rules`。例如 `?sections=setup,motion` |
| `full` | `1` 或 `true` 时原样返回整份工程文档 |

默认返回 `schemaVersion`、`meta`、`setup`、`motion`、`rules`，并去掉对 AI 没用的 `view`（相机机位）、`snapshots` 和 `meta.wizard`。只需要部分信息时用 `sections`，可以省 token。

### 示例

```json
{
  "version": 2,
  "updatedAt": 1791604114674,
  "revision": 1,
  "dirty": false,
  "config": {
    "schemaVersion": "…",
    "meta": { "id": "gz-2025", "name": "2025广州演唱会", "author": "…", "createdAt": "…", "modifiedAt": "…" },
    "setup": { "plcs": [], "motors": [], "controlledObjects": [], "alignment": {} },
    "motion": { "actionSequences": [] },
    "rules": {}
  }
}
```

### 常用内容

| 路径 | 说明 |
|---|---|
| `revision` | 软件内部的文档修订号 |
| `dirty` | `true` 表示有未保存的修改 |
| `setup.plcs[]` | 主控 PLC：`id`、`ip`、`masterTypeId` |
| `setup.motors[]` | 电机：`id`、`plcId`（所属 PLC）、`controlledObjectId`（绑定的物体，可为 `null`）、`productModel`（型号）、`busNo`（0=C 口，1=D 口）、`params` |
| `setup.controlledObjects[]` | 受控物体：`id`、`name`、`controlType`、`enabledVirtualAxes`、`parentId`（挂载的父物体）、`position` / `dimensions`（mm）、`rotation`（°）、`motionParams` 等 |
| `motion.actionSequences[]` | 动作序列：`id`、`name` 及时间轴内容 |

PLC、物体、电机的 `id` 在同一个工程里互不重复，和 `/api/status` 里的 `id` 一一对应。电机和 PLC 的显示名不保存在配置里，需要名称时看 `/api/status` 或 `/api/view`。

---

## GET /api/status：设备与动作实时状态

先列出配置里的全部设备（没有实时数据的标为离线），只在实时数据里出现、配置里没有的设备追加在后面，这类设备的 `name` 为 `null`。

### 参数

| 参数 | 说明 |
|---|---|
| `kinds` | 只返回指定种类，逗号分隔：`plcs`、`objects`、`motors`、`actions` |
| `plcs` / `objects` / `motors` / `actions` | 该种类只返回这些 id，逗号分隔。`actions` 填序列 id |

例：`/api/status?kinds=objects,motors&objects=9&motors=3,4`

### 示例

```json
{
  "version": 5,
  "updatedAt": 1791604114674,
  "connection": "connected",
  "plcs": [
    { "id": 14, "name": "主控PLC-01", "ip": "192.168.0.10", "live": true,
      "plcModel": 0, "masterStatus": 1, "simulationStatus": 0, "busStatus": 1,
      "ruleStartStatus": 0, "ruleId": 0, "autoRunStatus": 0, "autoId": 0 }
  ],
  "objects": [
    { "id": 9, "name": "升降灯架-01", "parentId": null, "live": true,
      "status": "running", "statusLabel": "运动", "modelStatus": 17,
      "virtualAxisHPosition": 1200.5, "virtualAxisPPosition": 0, "virtualAxisYPosition": 0 }
  ],
  "motors": [
    { "id": 3, "name": "500KG 数控葫芦轴-C-1", "plcId": 14, "objectId": 9, "live": true,
      "status": "running", "statusLabel": "运动", "axisStatus": 3,
      "actualPosition": 1200.5, "actualSpeed": 150, "actualTorque": 30, "driveAlarmCode": 0 }
  ],
  "actions": [
    { "sequenceId": 1, "name": "新建动作序列", "state": 3, "stateLabel": "运行中",
      "loopCount": 1, "loopCountSet": 3, "runTime": 120 }
  ]
}
```

### 顶层

| 字段 | 说明 |
|---|---|
| `connection` | 软件与 C++ 运行时的连接：`idle` / `connecting` / `connected` / `reconnecting` / `disconnected`。不是 `connected` 时所有设备都没有实时数据 |

### 通用设备字段（plcs / objects / motors）

| 字段 | 说明 |
|---|---|
| `id` | 设备 id，对应配置里的 `id` |
| `name` | 显示名；配置里没有这个设备时为 `null` |
| `live` | `true` 表示有实时数据；`false` 时只有配置信息 |

### plcs

| 字段 | 说明 |
|---|---|
| `ip` | 配置的 IP |
| `masterStatus` | `-1` 未连接 / `0` 初始化中 / `1` 正常 / `2` 挂起 / `3` 配置中 |
| `simulationStatus` | `1` 表示处于仿真模式 |
| `busStatus`、`ruleStartStatus`、`ruleId`、`autoRunStatus`、`autoId`、`plcModel` | PLC 原样上报的值 |

### objects（受控物体）

| 字段 | 说明 |
|---|---|
| `parentId` | 挂载的父物体 id，没有为 `null` |
| `status` | 归类后的状态，见下方"状态取值" |
| `statusLabel` | 中文状态，如 `静止`、`运动`、`耦合中`、`超行程`；没有实时数据时为 `离线` |
| `modelStatus` | PLC 原始状态码 |
| `virtualAxisHPosition` | 虚轴 v1 当前位置。升降类物体为 mm；旋转类物体（配置里 `controlType` 为 `4` 连续旋转或 `10` 单点旋转）为 ° |
| `virtualAxisPPosition` | 虚轴 v2（摆动 X）当前角度，° |
| `virtualAxisYPosition` | 虚轴 v3（摆动 Y / 偏转）当前角度，° |

### motors（电机）

| 字段 | 说明 |
|---|---|
| `plcId` | 所属 PLC |
| `objectId` | 绑定的受控物体，没有为 `null` |
| `status` / `statusLabel` | 归类后的状态 / 中文状态（`断电`、`错误`、`静止`、`运动`、`离线`） |
| `axisStatus` | 原始轴状态码：`0` 断电 / `1` 错误 / `2` 静止 / `3` 运动 |
| `actualPosition` | 实际位置，mm |
| `actualSpeed` | 实际速度，mm/s |
| `actualLoadRate` | 负载率，% |
| `actualTemperature` | 温度，°C |
| `actualTorque`、`actualWeight` | 力矩、称重；电机描述文件里没有标单位 |
| `driveAlarmCode` | 驱动器报警码，`0` 或缺省表示无报警 |
| 其他数值字段 | 不同电机型号额外上报的扩展状态，原样透传 |

### actions（正在运行的动作）

只包含 PLC 正在上报的动作。PLC 不会通知动作结束，超过 1 秒没有上报就视为已停止，并从列表里移除。

| 字段 | 说明 |
|---|---|
| `sequenceId` | 动作序列 id，对应配置里的 `motion.actionSequences[].id` |
| `name` | 序列名称 |
| `state` / `stateLabel` | `1` 过渡（正在回到轨迹上）/ `3` 运行中 |
| `loopCount` | 当前第几次循环 |
| `loopCountSet` | 设定的循环次数，`0` 表示无限循环 |
| `runTime` | 轨迹当前运行到的帧 |

### 状态取值（status）

| 值 | 含义 |
|---|---|
| `ready` | 就绪 / 静止 / 未耦合 |
| `running` | 运动中 |
| `warning` | 警告（限位、过载、欠载、刹车反馈异常、耦合中等） |
| `alarm` | 报警（错误停止、超行程、超速解耦等） |
| `disabled` | 已禁用 |
| `offline` | 离线或没有实时数据 |

---

## POST /api/sequences：新增或修改动作序列

请求体就是**一条**动作序列，结构和工程文件里 `motion.actionSequences[]` 的元素完全一致（可以先用 `GET /api/config?sections=motion` 看现有序列）。`id` 由调用方给定：

- 工程里已有这个 `id` → **整条替换**该序列（位置不变）；
- 没有 → 追加为新序列。

软件用和界面编辑完全相同的规则校验，**全部通过才写入**，否则工程不变。写入后是"未保存的修改"（`/api/config` 里 `dirty: true`），和用户在界面上编辑一样，需要用户在软件里保存工程才会写盘；动作页和节目面板会自动刷新显示。

### 请求

```bash
curl -s -X POST http://127.0.0.1:17890/api/sequences \
  -H 'Content-Type: application/json' \
  -d '{
    "id": 9,
    "name": "上升",
    "trajectoryMode": false,
    "blocks": [
      { "id": "p0", "kind": "pose", "objectId": 21, "atMs": 0,    "pose": { "v1": 0 } },
      { "id": "p1", "kind": "pose", "objectId": 21, "atMs": 4000, "pose": { "v1": 100 } }
    ],
    "segments": []
  }'
```

| 要求 | 说明 |
|---|---|
| `Content-Type` | 必须是 `application/json`，否则 415 |
| 请求体大小 | 不超过 2 MB，否则 413 |
| `Origin` 头 | 普通 HTTP 客户端不会带；带了且不是本服务地址时返回 403（防止网页跨站写入） |
| 演出模式 | 软件在演出模式时拒绝（409 `SHOW_MODE`），和界面一致 |
| 登录用户权限 | 按软件当前登录用户的权限：没有「编辑动作序列」或没人登录时拒绝（403 `FORBIDDEN`），和界面一致 |

### 序列结构要点

| 字段 | 说明 |
|---|---|
| `id` | 整数 1~65535 |
| `name` | 去掉首尾空格后 1~8 个字符，不能和其他序列重名 |
| `note` | 可选，备注 |
| `trajectoryMode` | 布尔 |
| `loop` | 可选。`true` 时每个物体的起点和终点位姿必须一致（升降 1 mm、角度 0.1° 以内），否则拒绝 |
| `blocks[]` | 时间轴块，`id` 在本序列内不能重复。`kind` 为 `pose`（位姿）/ `instruction`（使能指令）/ `static-preset` / `dynamic-preset`，字段同工程文件 |
| `blocks[].pose` | 位姿值 `{ v1, v2, v3 }`，缺少的轴表示这一帧"经过"、不停；单位见"单位"一节 |
| `blocks[].passSpeeds` | 可选，各轴经过速度（绝对值），`0` 表示停在这一帧 |
| `segments[]` | 运动区间的加减速设置 `{ fromRef, toRef, settings: { profiles: { v1, v2, v3 } } }`；可以给空数组，缺少的区间按默认加减速 |

`objectId` 必须是工程里存在的受控物体，位姿不能超出物体的行程，速度、加速度不能超过物体的限制。

### 成功

新增返回 `201`，修改返回 `200`：

```json
{
  "ok": true,
  "created": true,
  "changed": true,
  "sequence": { "id": 9, "name": "上升", "trajectoryMode": false, "blocks": [], "segments": [] },
  "warnings": []
}
```

| 字段 | 说明 |
|---|---|
| `created` | `true` 新增，`false` 修改已有序列 |
| `changed` | 提交的内容和已有序列完全相同时为 `false`，工程不变 |
| `sequence` | 实际写入的序列（`name` 已去掉首尾空格） |
| `warnings` | 不阻止写入的提醒（如长时间静止），格式同下方 `issues` |

`/api/config` 在写入后约 300ms 反映新内容。

### 失败

```json
{
  "ok": false,
  "code": "VALIDATION_FAILED",
  "message": "动作序列校验未通过：…",
  "issues": [
    { "severity": "error", "code": "limit-exceeded", "message": "…", "blockId": "p1", "objectId": 21, "atMs": 4000 }
  ]
}
```

| HTTP 状态 | code | 原因 |
|---|---|---|
| 400 | `INVALID_JSON` | 请求体不是合法 JSON |
| 400 | `INVALID_SEQUENCE` | 结构和工程动作序列不一致；`message` 指出具体字段，如 `sequence.blocks[0].atMs` |
| 403 | `FORBIDDEN_ORIGIN` | 来自其他网站的浏览器请求 |
| 403 | `FORBIDDEN` | 软件当前登录用户没有「编辑动作序列」权限，或没人登录 |
| 409 | `NO_PROJECT` | 软件没有打开工程 |
| 409 | `SHOW_MODE` | 软件处于演出模式 |
| 409 | `BUSY` | 用户正在界面上编辑（如属性面板）或正在恢复版本，稍后重试 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 2 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` 不是 `application/json` |
| 422 | `VALIDATION_FAILED` | 结构对但校验不通过：重名、名称超长、块 id 重复、引用不存在的物体、循环首尾不闭合，或 `issues` 里有 `severity: "error"` 的问题 |
| 503 | `RENDERER_UNAVAILABLE` | 软件界面没连上（刚启动或正在刷新） |
| 504 | `TIMEOUT` | 界面 5 秒内没有应答 |

`issues[]` 每项：`severity`（`error` 阻止写入 / `warning` 仅提醒）、`code`、`message`，以及可选的 `blockId`、`objectId`、`segmentKey`、`atMs`、`suggestedDurationMs`（建议的区间时长，毫秒）。常见 `code`：`missing-object`、`limit-exceeded`、`acceleration-exceeded`、`duplicate-pose-time`、`motion-overlap`、`invalid-preset`、`invalid-motion-profile`、`motor-overspeed`、`angle-protection`、`pass-speed-infeasible`。

---

## 单位

### 接口里的数值

| 量 | 单位 |
|---|---|
| 长度、位置（配置里的 `position`、`dimensions`，物体升降位置，电机位置） | mm |
| 速度 / 加速度 | mm/s / mm/s² |
| 角度（物体旋转、摆动、偏转，配置里的 `rotation`） | ° |
| 电机负载率 / 温度 | % / °C |

- 工程文件和 C++ 通讯一律用上面这套单位，接口直接透传，不做换算。
- 电机遥测的单位来自电机型号描述文件 `Configs/motors/<型号>.json` 里每个字段的 `unit`。目前只有 SV660 一个型号，单位如上表。软件界面把收到的值直接当作这个单位显示，没有再乘描述文件里的 `scale`。
- 判断物体升降位置是 mm 还是 °：看 `/api/config` 里该物体的 `controlType`，`4` 和 `10` 是旋转类（°），其他有升降轴的类型是 mm。

### 软件的"显示单位"设置

软件"系统设置 → 界面 → 显示单位"可选 mm / cm / m / in，只影响界面上长度类数值（mm、mm/s、mm/s²）的显示和输入，角度、百分比等不受影响。

- 设置保存在本机，**重启软件后才生效**。
- 修改设置不会改变工程文件、C++ 通讯，也不会改变本接口返回的数值。
- 本接口目前**不返回**用户选的显示单位。如果要按用户习惯的单位回答，需要 AI 自己换算：1 cm = 10 mm，1 m = 1000 mm，1 in = 25.4 mm。

---

## 给 AI 的使用建议

- **回答"用户在看什么"**：先查 `/api/view`。它已经带了名称，通常不用再查别的接口。
- **回答"某个物体现在怎么样"**：从 `/api/view` 拿到选中物体的 id，再查 `/api/status?kinds=objects,motors&objects=<id>`。用电机的 `objectId` 找出绑在这个物体上的电机。
- **回答配置问题**：用 `/api/config?sections=setup` 或 `sections=motion` 按需取，不要每次都取整份。
- **判断实时数据是否可信**：先看 `connection` 和每个设备的 `live`。`live: false` 时只能说明配置，不能说明现场状态。
- **持续关注时**：用 `If-None-Match` 轮询，1 秒左右一次就够了。
- **报数值时带上单位**：长度默认是 mm，角度是 °。旋转类物体的升降位置其实是角度，见"单位"一节。
- **编写动作序列**：先 `GET /api/config?sections=setup,motion` 拿物体 id、行程和现有序列，再 `POST /api/sequences`。被 422 拒绝时按 `issues` 修改后重试；写入成功后提醒用户在软件里保存工程。
- **涉及控制操作**：本服务不能让设备动作，执行动作需要用户在软件界面里自己操作。
