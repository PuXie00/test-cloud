import { useEffect, useMemo, useState, type ReactNode } from "react";
import { deviceKey, motorLabel, type LogRecord } from "@shared/csocket/operation-log";
import { cn } from "@/app/components/ui/utils";
import { alarmReviewWindow, MAX_TREND_DEVICES, pickTrendDevices } from "./alarm-review";
import { LogBadge } from "./log-badge";
import {
  formatClockMs,
  formatDateTime,
  formatRelativeSeconds,
  isFailedOperation,
  resultText,
} from "./log-display";
import { SnapshotTable } from "./snapshot-table";
import { SERIES_COLORS, TrendCharts } from "./trend-charts";
import type { AlarmReviewState } from "./use-operation-log";

const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <header className="flex items-baseline justify-between gap-2">
      <h3 className="text-label-caps normal-case text-muted-foreground">{title}</h3>
      {hint ? <span className="truncate text-label-caps normal-case text-muted-foreground">{hint}</span> : null}
    </header>
    {children}
  </section>
);

/** 选中设备占用的颜色槽位；取消选中才释放，保证其余设备颜色不变 */
type ColorSlots = (string | null)[];

const toSlots = (keys: string[]): ColorSlots =>
  Array.from({ length: MAX_TREND_DEVICES }, (_, index) => keys[index] ?? null);

type AlarmReviewPanelProps = {
  alarm: LogRecord;
  state: AlarmReviewState;
  showDebug: boolean;
  cursor: number | null;
  onCursorChange: (t: number) => void;
};

export const AlarmReviewPanel = ({
  alarm,
  state,
  showDebug,
  cursor,
  onCursorChange,
}: AlarmReviewPanelProps) => {
  const review = state.status === "ready" ? state.review : null;
  const [slots, setSlots] = useState<ColorSlots>(() => toSlots([]));

  useEffect(() => {
    setSlots(toSlots(review ? pickTrendDevices(review) : []));
  }, [review]);

  const records = useMemo(
    () => review?.records.filter((r) => showDebug || r.level !== "debug") ?? [],
    [review, showDebug],
  );
  const operationsBefore = records.filter(
    (r) => r.category === "optCall" && r.timestamp <= alarm.timestamp,
  );
  const operationOffsetsMs = useMemo(
    () =>
      records.filter((r) => r.category === "optCall").map((r) => r.timestamp - alarm.timestamp),
    [records, alarm.timestamp],
  );

  const range = useMemo(() => alarmReviewWindow(alarm), [alarm]);
  const at = cursor != null && cursor >= range.start && cursor <= range.end ? cursor : alarm.timestamp;
  const selectedSeries = useMemo(
    () => review?.snapshot.filter((s) => slots.includes(deviceKey(s))) ?? [],
    [review, slots],
  );
  const colorOf = (key: string) => SERIES_COLORS[Math.max(0, slots.indexOf(key))];

  const toggleDevice = (key: string) =>
    setSlots((current) => {
      const index = current.indexOf(key);
      if (index >= 0) return current.map((slot, i) => (i === index ? null : slot));
      const free = current.indexOf(null);
      return free < 0 ? current : current.map((slot, i) => (i === free ? key : slot));
    });
  const slotsFull = !slots.includes(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <LogBadge record={alarm} className="mt-0.5" />
          <p className="min-w-0 flex-1 text-body-md font-medium text-foreground">{alarm.message}</p>
        </div>
        <p className="font-mono text-mono-sm text-muted-foreground">{formatDateTime(alarm.timestamp)}</p>
      </div>

      {state.status === "loading" && (
        <p className="text-body-sm text-muted-foreground">正在读取报警快照…</p>
      )}
      {state.status === "error" && <p className="text-body-sm text-destructive">{state.error}</p>}

      {review && (
        <>
          <Section
            title={`报警前后记录（${formatRelativeSeconds(range.start - alarm.timestamp)} ~ ${formatRelativeSeconds(range.end - alarm.timestamp)}）`}
            hint={operationsBefore.length > 0 ? `报警前 ${operationsBefore.length} 条操作` : "报警前无操作"}
          >
            <ol className="flex flex-col rounded-sm border border-border/60 bg-background">
              {records.map((record) => {
                const isAlarm = record.id === alarm.id;
                const isCauseCandidate =
                  record.category === "optCall" && record.timestamp <= alarm.timestamp;
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => onCursorChange(record.timestamp)}
                      className={cn(
                        "flex w-full items-start gap-2 border-l-2 border-transparent px-2 py-1 text-left transition-colors hover:bg-accent",
                        isCauseCandidate && "border-primary",
                        isAlarm && "border-destructive bg-destructive/10",
                      )}
                    >
                      <span className="w-12 shrink-0 text-right font-mono text-mono-sm tabular-nums text-muted-foreground">
                        {formatRelativeSeconds(record.timestamp - alarm.timestamp)}
                      </span>
                      <LogBadge record={record} />
                      <span className="min-w-0 flex-1 text-body-sm text-foreground">
                        {record.message}
                        {record.user ? <span className="text-muted-foreground"> · {record.user}</span> : null}
                        {isFailedOperation(record) ? (
                          <span className="text-destructive"> · {resultText(record)}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Section>

          {review.snapshot.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">该时段没有状态快照</p>
          ) : (
            <>
              <Section title="趋势分析" hint={`转矩 / 位置 / 速度，最多 ${MAX_TREND_DEVICES} 台`}>
                <div className="flex flex-wrap gap-1" role="group" aria-label="曲线设备">
                  {review.snapshot.map((series) => {
                    const key = deviceKey(series);
                    const selected = slots.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        disabled={!selected && slotsFull}
                        onClick={() => toggleDevice(key)}
                        className={cn(
                          "inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-body-sm transition-colors",
                          selected
                            ? "border-border bg-accent text-foreground"
                            : "border-border/60 text-muted-foreground hover:text-foreground",
                          "disabled:pointer-events-none disabled:opacity-40",
                        )}
                      >
                        <span
                          className="h-0.5 w-3 rounded-full"
                          style={{ backgroundColor: selected ? colorOf(key) : "var(--border)" }}
                          aria-hidden
                        />
                        {motorLabel(series.deviceId)}
                      </button>
                    );
                  })}
                </div>
                <TrendCharts
                  series={selectedSeries}
                  colorOf={colorOf}
                  alarmTime={alarm.timestamp}
                  range={range}
                  operationOffsetsMs={operationOffsetsMs}
                  cursorOffsetMs={at - alarm.timestamp}
                  onCursorChange={onCursorChange}
                />
              </Section>

              <Section
                title="状态快照"
                hint={`${formatClockMs(at)}（${formatRelativeSeconds(at - alarm.timestamp)}）`}
              >
                <SnapshotTable snapshot={review.snapshot} at={at} />
                <p className="text-label-caps normal-case text-muted-foreground">
                  点击曲线、记录或时间线可切换时刻
                </p>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
};
