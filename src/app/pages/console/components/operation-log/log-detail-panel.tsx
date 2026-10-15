import { memo } from "react";
import type { LogRecord } from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import { AlarmReviewPanel } from "./alarm-review-panel";
import { LogBadge } from "./log-badge";
import {
  ALARM_LEVEL_LABEL,
  CATEGORY_LABEL,
  formatClockMs,
  formatDate,
  isRaisedAlarm,
  LOG_LEVEL_LABEL,
  OP_GROUP_LABEL,
  resultText,
} from "./log-display";
import { opTypeKey } from "./log-filters";
import type { AlarmReviewState } from "./use-operation-log";

const RecordDetail = ({ record, opTypeLabels }: { record: LogRecord; opTypeLabels: Map<string, string> }) => {
  const rows: [string, string][] = [
    ["时间", `${formatDate(record.timestamp)} ${formatClockMs(record.timestamp)}`],
    ["类别", record.opGroup ? OP_GROUP_LABEL[record.opGroup] : CATEGORY_LABEL[record.category]],
    ["日志级别", LOG_LEVEL_LABEL[record.level]],
  ];
  if (record.user) rows.push(["操作人", record.user]);
  if (record.opGroup && record.opType) {
    rows.push(["操作类型", opTypeLabels.get(opTypeKey(record.opGroup, record.opType)) ?? record.opType]);
  }
  const result = resultText(record);
  if (result) rows.push(["结果", result]);
  if (record.alarmLevel) rows.push(["报警级别", ALARM_LEVEL_LABEL[record.alarmLevel]]);
  if (record.alarmCode != null) rows.push(["报警码", String(record.alarmCode)]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <LogBadge record={record} className="mt-0.5" />
        <p className="min-w-0 flex-1 text-body-md font-medium text-foreground">{record.message}</p>
      </div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-body-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "break-words text-foreground",
                label === "结果" && record.result?.ok === false && "text-destructive",
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {record.devices?.length ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-label-caps text-muted-foreground">涉及设备（{record.devices.length}）</h3>
          <ul className="flex flex-col rounded-sm border border-border/60 bg-background">
            {record.devices.map((device) => (
              <li
                key={`${device.deviceType}:${device.deviceId}`}
                className="flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1 text-body-sm last:border-b-0"
              >
                <span className="truncate text-foreground">{device.deviceName}</span>
                {device.ok != null && (
                  <span className={device.ok ? "text-show" : "text-destructive"}>
                    {device.ok ? "成功" : "失败"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

type LogDetailPanelProps = {
  selected: LogRecord | null;
  review: AlarmReviewState;
  showDebug: boolean;
  cursor: number | null;
  onCursorChange: (t: number) => void;
  opTypeLabels: Map<string, string>;
  className?: string;
};

/** memo：只在选中、回看数据或游标变化时重画，拖动时间线不重画曲线图 */
export const LogDetailPanel = memo(({
  selected,
  review,
  showDebug,
  cursor,
  onCursorChange,
  opTypeLabels,
  className,
}: LogDetailPanelProps) => (
  <aside className={cn("custom-scrollbar flex flex-col gap-4 overflow-y-auto bg-card p-3", className)}>
    {selected && isRaisedAlarm(selected) ? (
      <AlarmReviewPanel
        alarm={selected}
        state={review}
        showDebug={showDebug}
        cursor={cursor}
        onCursorChange={onCursorChange}
      />
    ) : selected ? (
      <RecordDetail record={selected} opTypeLabels={opTypeLabels} />
    ) : (
      <p className="text-body-sm text-muted-foreground">
        点击记录查看详情。点击报警记录，自动展示报警前 10s、后 5s 的操作记录、状态快照和转矩 / 位置 / 速度曲线。
      </p>
    )}
  </aside>
));
