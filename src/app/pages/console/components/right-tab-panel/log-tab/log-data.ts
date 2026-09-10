export type LogLevel = "info" | "operation" | "warning" | "alarm" | "fault";

export type LogEntry = {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  deviceId?: string;
};

const NOW = Date.now();

export const INITIAL_LOGS: LogEntry[] = Array.from({ length: 30 }, (_, idx) => {
  const offset = (30 - idx) * 4000;
  const levels: LogLevel[] = ["info", "operation", "operation", "warning", "alarm"];
  const level = levels[idx % levels.length];
  return {
    id: `log-${idx}`,
    timestamp: NOW - offset,
    level,
    message:
      level === "alarm"
        ? "升降灯架-01 速度超限"
        : level === "warning"
          ? "驱动器-03 温度 65°C ↗ 70°C"
          : level === "operation"
            ? "操作员 触发 Cue-01"
            : "系统状态正常",
  };
});

const SAMPLES: { level: LogLevel; message: string }[] = [
  { level: "info", message: "通讯心跳正常" },
  { level: "operation", message: "操作员 调整 速度 100% → 120%" },
  { level: "operation", message: "操作员 选择 升降灯架-02" },
  { level: "warning", message: "电机轴-3 温度上升至 72°C" },
  { level: "alarm", message: "桁架-01 位置偏差超出阈值" },
];

export const generateLogEntry = (): LogEntry => {
  const sample = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  return {
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    level: sample.level,
    message: sample.message,
  };
};
