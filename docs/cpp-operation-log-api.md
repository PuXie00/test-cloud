# 操作日志与报警记录：C++ 接口说明

对应需求「11.3 操作日志与报警记录」：统一时间线记录操作、报警和状态变化，核心用于异常回溯。

- **职责：** C++ 把日志写进**当前工程目录下的 SQLite 文件 `logs.db`**；前端直接读这个文件查询（只读，只用 SELECT），不再经过 C++ 查询。界面自己产生的事件（如保存工程）调用 `Log|write` 交给 C++ 写。
- **生命周期：** 日志按工程独立，一个工程一个 `logs.db`，放在工程目录（`Project/<工程名>/logs.db`），所以表里没有工程 id。打开工程（`CONFIG|Pro|open`）开始记录，关闭工程结束。
- **前端现状：** 查询已接好（`electron/main/cSocket/api.ts` 的 `logQuery` / `logFilterOptions` / `logAlarmReview` 直接读库，查询代码在 `operation-log-db.ts`）。`logs.db` 不存在时前端按"还没有日志"显示空列表。`Log|write` 在 C++ 实现前仍由 mock 返回。

| 前端位置 | 数据来源 |
|---|---|
| 头部菜单 →「操作日志与回放」弹窗：统一时间线、筛选、报警回看、趋势分析 | 前端读 `logs.db` |
| 控制页右侧「日志」：本工程最新 30 条；底部状态栏时间左侧：最新一条 | C++ 推送 `Info\|log`（打开工程后列表为空，只靠推送追加；不显示操作人） |
| 保存工程 / 工程另存为（结果成功或失败） | `Log\|write` |

## C++ 需要做的

1. 打开工程时打开（没有就创建）`<工程目录>/logs.db`，按下面的表结构建表，开 WAL。
2. 每条日志写一行 `log`。
3. 轴报警发生时把状态快照写进 `axis_alarm_snapshot`（见「状态快照」）。
4. 每写一条日志推送一次 `Info|log`（可合并成一批）。
5. 实现 `Log|write`。

## 表结构

```sql
PRAGMA journal_mode = WAL;      -- 前端读、C++ 写互不阻塞
PRAGMA synchronous = NORMAL;

-- 日志：下发指令 / 操作回码 / 轴报警 / 系统，一条一行
CREATE TABLE IF NOT EXISTS log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT, -- 前端转成字符串当记录 id
  ts          INTEGER NOT NULL,                  -- 毫秒时间戳（本机时钟）
  category    TEXT    NOT NULL CHECK (category IN ('optCall','optRet','axisAlarm','system')),
  level       TEXT    NOT NULL CHECK (level IN ('debug','info','warning','error')),
  message     TEXT    NOT NULL,                  -- 展示文案；报警时为报警描述
  user_name   TEXT,                              -- 操作人，取报文里的 userName（登录用户名，如 admin）
  op_group    TEXT    CHECK (op_group IN ('config','device')),
  op_type     TEXT,                              -- saveProject / jog / ...（只存库，界面暂不显示）
  addr        TEXT,                              -- 指令地址（只存库，界面不显示）
  result_ok   INTEGER                            -- 结果码：0 成功 / 103 超时 / 其它都是失败
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON log(ts);

-- 轴报警状态快照采样点：按时间存，不挂在某条报警上；只有电机（轴）
CREATE TABLE IF NOT EXISTS axis_alarm_snapshot (
  ts          INTEGER NOT NULL,                  -- 采样时刻（毫秒），同一拍所有电机用同一个 ts
  device_id   INTEGER NOT NULL,                  -- 电机 id
  position    REAL,                              -- mm
  speed       REAL,                              -- mm/s
  torque      REAL,                              -- 额定转矩的 %
  temperature REAL,                              -- ℃
  PRIMARY KEY (ts, device_id)
) WITHOUT ROWID;
```

- `axis_alarm_snapshot` 不要加自增 `id`：SQLite 不允许 `AUTOINCREMENT` 和 `WITHOUT ROWID` 一起用；两个报警时间段重叠时，`INSERT OR IGNORE` 靠 `(ts, device_id)` 主键跳过重复的点。
- 前端按列名读，不依赖列顺序；可以加列，但不要改名或删列。

## 各类记录怎么填

| `category` | 含义 | 前端 | 要填的字段 |
|---|---|---|---|
| `optCall` | 前端下发的指令 | **只存库，不查、不显示** | C++ 自定 |
| `optRet` | 操作回码，PLC 回码后写 | 显示为「操作」 | `user_name`、`op_group`、`result_ok`；`op_type`、`addr` 只存库 |
| `axisAlarm` | 轴报警 | 显示为「报警」，每条都能回看快照 | 只要 `ts`、`level`、`message` |
| `system` | 状态变化 / 内部细节 | 显示为「系统」 | 只要 `ts`、`level`、`message` |

- 下发指令（`optCall`）和操作回码（`optRet`）各记一条。
- `result_ok` 直接写 PLC 回的码：`0` 成功、`103` 超时，其它任何值界面都显示为「失败」。
- `op_type`、`addr` 前端不读、不显示，暂时也不按操作类型筛选；按操作人筛选只约束 `optRet`。
- 界面上类别徽标的颜色只看 `level`（信息灰、警告黄、错误红）。失败、超时的回码请用 `warning` 或 `error`，否则看不出来。
- 没有失败原因字段，需要的话写进 `message`。
- 报警没有级别、报警码、发生 / 清除状态。
- 系统内部报错、底层通讯细节等用户无感的内容用 `debug` 级别，前端默认隐藏（筛选「日志级别」选「调试」或「全部（含调试）」才显示）。

**`op_type` 建议取值**（只存库，界面暂不显示）：

| op_group | op_type | 含义 | 对应命令 |
|---|---|---|---|
| config | `saveProject` | 保存工程 | 界面 `Log\|write` |
| config | `saveProjectAs` | 工程另存为 | 界面 `Log\|write` |
| config | `downloadProject` | 下载工程 | `CONFIG\|Pro\|download` |
| device | `couple` | 耦合 / 解耦 | `Opera\|couple` |
| device | `enable` | 使能 / 禁用 | `Opera\|enable` |
| device | `jog` | 点动 | `Opera\|jog` |
| device | `moveTarget` | 启动（目标位置） | `Opera\|moveTarget` |
| device | `stop` | 停止 | `Opera\|stop`、`Opera\|syncMoveEnd`、`Opera\|actionCall` |
| device | `eStop` | 急停 | `Opera\|eStop`、`Opera\|AllStop` |
| device | `sequence` | 执行动作序列 | `Opera\|syncMovebegin`、`Opera\|actionSyncRelease` |
| device | `setOrigin` | 设定原点 | `Opera\|setPosition` |
| device | `ruleEdit` | 规则引擎修改 | 规则相关命令 |

## 状态快照

时间段固定为**报警前 10s ~ 报警后 5s**，前端按报警时刻自己算，库里不存时间段。

```
C++ 维护一个 10s 的环形缓冲区，持续缓存电机状态（100ms 采样）：
  - 没有报警 → 不写库
  - 轴报警发生（时刻 T）→ 把缓冲区里 T-10s ~ T 的点 INSERT OR IGNORE 进 axis_alarm_snapshot
                    → record_until = max(record_until, T + 5s)
  - 每拍采样时若 now ≤ record_until，这一拍所有电机也 INSERT OR IGNORE（一拍一个事务）
```

前端回看时取 `ts BETWEEN T-10000 AND T+5000` 的全部采样点，按电机分组画曲线；报警后 5s 还没写完时，有多少显示多少。

## Info|log：新日志推送

C++ 每写入一条日志就主动推送（可以合并成一批），包括 `Log|write` 写入的。前端按 `id` 去重后追加到控制页列表，只保留最新 30 条，最新一条显示在状态栏。`optCall` 和 `debug` 不用推（推了前端也会过滤掉）。

```json
{ "OptCmd": "Info|log", "result": { "success": true, "data": [ /* LogRecord */ ] } }
```

LogRecord（JSON 字段 ← 表列）：

| 字段 | 类型 | 来自 |
|---|---|---|
| `id` | string | `id` 转字符串 |
| `timestamp` | number | `ts` |
| `category` | `"optRet"` \| `"axisAlarm"` \| `"system"` | `category` |
| `level` | `"debug"` \| `"info"` \| `"warning"` \| `"error"` | `level` |
| `message` | string | `message` |
| `user` | string，可缺省 | `user_name` |
| `opGroup` | `"config"` \| `"device"`，可缺省 | `op_group` |
| `result` | number，可缺省；0 成功 / 103 超时 / 其它失败 | `result_ok` |

列为 NULL 时 JSON 里不出这个字段。

## Log|write：界面写日志

界面自己产生、C++ 看不到的事件交给 C++ 写入当前工程的 `logs.db`。C++ 补上 `id`、`user_name`（取报文里的 `userName`），写完后照常 `Info|log` 推送。请求沿用现有报文格式，`addr` 为空串。

```json
"params": [{
  "category": "optRet",
  "level": "warning",
  "opGroup": "config",
  "opType": "saveProject",
  "message": "保存工程「演示工程」：磁盘空间不足",
  "result": 1,
  "timestamp": 1791861234567
}]
```

`category` 只能是 `optRet` 或 `system`；`result` 成功写 `0`，界面自己写失败时用 `1`；`opType` 照常带上，C++ 写进 `op_type` 列存库；`timestamp` 为事件发生时间，缺省用 C++ 收到的时间。应答 `data` 返回写入后的 LogRecord。

目前界面会写的：保存工程、工程另存为（成功和失败都写）。

---

## 报文里的操作人：userName

每条发给 C++ 的报文外层都带 `userName`（原来叫 `user`），值是当前登录的**用户名**（如 `admin`），不是界面上显示的名字。登录、切换用户、退出登录时主进程会自动更新；没登录时不带这个字段。C++ 写 `optCall` / `optRet` / `Log|write` 时把它写进 `user_name`，操作日志弹窗的「操作人」筛选列出的就是这些用户名。
