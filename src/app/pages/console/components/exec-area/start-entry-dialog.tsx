import { useMemo, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, Minus, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { cn } from "@/app/components/ui/utils";
import { isSignificantMove } from "@/app/project/action-sequence/initial-pose-gate";
import type { NearestStartPlan } from "@/app/project/action-sequence/nearest-start";
import {
  evaluateStartEntry,
  pickEntryFrame,
  startEntryFrames,
  stepEntryFrame,
  type StartEntryChoice,
  type StartEntryInput,
  type StartEntryOutcome,
} from "@/app/project/action-sequence/start-entry";

/** fader：推子槽 Ready；next：任务卡下一条；rerun：任务卡继续 / 反向回（后两种确认后直接 GO） */
export type StartEntryIntent = "fader" | "next" | "rerun";

export type StartEntryRequest = {
  intent: StartEntryIntent;
  input: StartEntryInput;
  /** 默认选中的方式：推子槽的就近开关，继续 / 反向回为从停下处继续 */
  defaultChoice: StartEntryChoice;
  /** 弹窗打开后设备位置变了、已按新位置重算时的提示 */
  notice: string | null;
};

type StartEntryDialogProps = {
  request: StartEntryRequest | null;
  onCancel: () => void;
  onConfirm: (plan: NearestStartPlan) => void;
};

type ChoiceKind = StartEntryChoice["kind"];

const formatSeconds = (seconds: number): string => `${(Math.round(seconds * 10) / 10).toFixed(1)} 秒`;

const formatFrame = (frameMs: number): string => formatSeconds(frameMs / 1000);

/** 有设备要先移动（有轴超过 1mm / 0.1°） */
const planMoves = (plan: NearestStartPlan): boolean =>
  plan.members.some((member) => member.axes.some(isSignificantMove));

const outcomeMeta = (outcome: StartEntryOutcome): string => {
  if (!outcome.ok) return "无法接入";
  const moving = planMoves(outcome.plan);
  return `${formatFrame(outcome.plan.targetFrameMs)} · ${moving ? `过渡 ${formatSeconds(outcome.transitionSeconds)}` : "无需移动"}`;
};

const ChoiceRow = ({
  label,
  meta,
  hint,
  selected,
  isDefault,
  failed,
  onSelect,
}: {
  label: string;
  meta: string;
  hint?: string;
  selected: boolean;
  isDefault: boolean;
  failed: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={cn(
      "flex min-h-10 w-full items-center gap-3 rounded-md bg-input-background px-3 py-2 text-left",
      selected ? "ring-1 ring-primary" : "hover:bg-accent",
    )}
  >
    <span
      aria-hidden
      className={cn(
        "h-3.5 w-3.5 shrink-0 rounded-full border",
        selected ? "border-4 border-primary" : "border-muted-foreground",
      )}
    />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-center gap-2 text-body-md text-foreground">
        {label}
        {isDefault ? (
          <span className="rounded-full bg-muted px-2 text-body-sm text-muted-foreground">默认</span>
        ) : null}
      </span>
      {hint ? <span className="text-body-sm text-muted-foreground">{hint}</span> : null}
    </span>
    {/* 字号和颜色不能放进同一个 cn：tailwind-merge 把 text-mono-sm 当颜色类合并掉 */}
    <span
      className={`shrink-0 font-mono text-mono-sm tabular-nums ${failed ? "text-destructive" : "text-muted-foreground"}`}
    >
      {meta}
    </span>
  </button>
);

const SummaryTile = ({
  label,
  value,
  caption,
  testId,
  emphasis = false,
}: {
  label: string;
  value: string;
  caption?: string;
  testId: string;
  emphasis?: boolean;
}) => (
  <div className="flex min-w-0 flex-col rounded-md bg-muted px-3 py-2">
    <span className="text-body-sm text-muted-foreground">{label}</span>
    <span
      data-testid={testId}
      className={`font-mono text-mono-md tabular-nums ${emphasis ? "text-primary" : "text-foreground"}`}
    >
      {value}
    </span>
    {caption ? <span className="truncate text-body-sm text-muted-foreground">{caption}</span> : null}
  </div>
);

const StartEntryBody = ({
  request,
  onConfirm,
}: {
  request: StartEntryRequest;
  onConfirm: (plan: NearestStartPlan) => void;
}) => {
  const { input, intent, defaultChoice } = request;
  const forced = input.sequence.trajectoryMode === true;
  const reverse = input.reverse;
  const reference = input.referenceFrameMs;
  // 都按打开时冻结的设备位置算；就近搜索最慢，只在打开或重算时跑一次
  const frames = useMemo(() => startEntryFrames(input), [input]);
  const nearest = useMemo(() => evaluateStartEntry(input, { kind: "nearest" }), [input]);
  const boundary = useMemo(() => evaluateStartEntry(input, { kind: "boundary" }), [input]);
  const [selected, setSelected] = useState<ChoiceKind>(defaultChoice.kind);
  const [frameMs, setFrameMs] = useState<number>(() => {
    if (defaultChoice.kind === "frame") return defaultChoice.frameMs;
    const recommended = defaultChoice.kind === "nearest" ? nearest : boundary;
    if (recommended.ok) return recommended.plan.targetFrameMs;
    if (reference !== undefined) return Math.round(reference);
    return reverse ? (frames?.lastMs ?? 0) : (frames?.firstMs ?? 0);
  });
  const specified = useMemo(() => evaluateStartEntry(input, { kind: "frame", frameMs }), [input, frameMs]);

  const outcomeOf = (kind: ChoiceKind): StartEntryOutcome =>
    kind === "nearest" ? nearest : kind === "boundary" ? boundary : specified;
  const outcome = outcomeOf(selected);
  const recommended = outcomeOf(defaultChoice.kind);
  const moving = outcome.ok && planMoves(outcome.plan);

  const startWord = reverse ? "动作末尾" : "动作起点";
  const reason = (() => {
    if (!recommended.ok) {
      // 就近和从头开始都算不出来时多半是设备参数或位置的问题，改选也没用
      return nearest.ok || boundary.ok
        ? `默认的接入方式用不了：${recommended.message}。可以改选其它接入点。`
        : `按现在的设备位置算不出接入方案：${recommended.message}。`;
    }
    const at = formatFrame(recommended.plan.targetFrameMs);
    const recommendedMoves = recommended.plan.members.some((member) => member.axes.some(isSignificantMove));
    if (reference !== undefined) {
      return `设备已离开停下时的位置（${formatFrame(reference)}），继续前要先移动到 ${at}处。也可以改选。`;
    }
    if (defaultChoice.kind === "nearest") {
      return recommendedMoves
        ? `设备不在${startWord}。已开启就近，推荐从 ${at}接入，也可以改选。`
        : `设备正停在动作的 ${at}处，就近会从这里开始，跳过的部分不运行。也可以改选。`;
    }
    return `设备不在${startWord}，开始前要先移回${startWord}。也可以改选就近或指定位置。`;
  })();

  const runWord = reverse ? "后" : "前";
  const totalMs = frames?.totalMs ?? 0;
  const percentOf = (ms: number) => (totalMs > 0 ? Math.min(100, Math.max(0, (ms / totalMs) * 100)) : 0);
  const targetMs = outcome.ok ? outcome.plan.targetFrameMs : null;
  const chained = intent !== "fader";

  const consequence = (() => {
    if (!outcome.ok) return null;
    const at = formatFrame(outcome.plan.targetFrameMs);
    if (chained) {
      return moving
        ? "确认后立即开始：设备先移动到接入点，到位后一起开始动作。"
        : `确认后立即从 ${at}开始动作。`;
    }
    return moving
      ? "确认后只把方案发给 PLC 准备，设备不会动；按 GO 时设备先移动到接入点，到位后一起开始动作。"
      : `确认后只把方案发给 PLC 准备，设备不会动；按 GO 时从 ${at}开始动作。`;
  })();

  const pickOnTimeline = (event: MouseEvent<HTMLButtonElement>) => {
    if (!frames || totalMs <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setFrameMs(pickEntryFrame(frames, fraction * totalMs, forced));
    setSelected("frame");
  };

  const step = (delta: -1 | 1) => {
    if (!frames) return;
    setFrameMs((current) => stepEntryFrame(frames, current, delta, forced));
    setSelected("frame");
  };

  const specifiedHint = (() => {
    if (selected !== "frame") return forced ? "任意时间点" : "只能接在关键帧";
    if (!forced && specified.ok && Math.abs(specified.plan.targetFrameMs - frameMs) > 0.5) {
      return `选的是 ${formatFrame(frameMs)}，非强制轨迹实际从 ${formatFrame(specified.plan.targetFrameMs)}的关键帧接入`;
    }
    return forced ? "按 − / + 每次 0.1 秒，或点时间轴" : "按 − / + 换关键帧，或点时间轴";
  })();

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-sm font-semibold leading-5 text-foreground">选择从哪里开始</AlertDialogTitle>
        <p className="text-body-sm text-muted-foreground">
          {`${input.sequence.name} · ${reverse ? "反向" : "正向"} · ${forced ? "强制轨迹" : "非强制轨迹"}`}
        </p>
        <AlertDialogDescription className="text-body-md text-foreground">{reason}</AlertDialogDescription>
      </AlertDialogHeader>

      <div className="flex flex-col gap-3 rounded-md bg-background p-3">
        {request.notice ? (
          <p role="status" className="text-body-sm text-warning">
            {request.notice}
          </p>
        ) : null}

        {frames && totalMs > 0 ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              aria-label="在时间轴上选择接入位置"
              onClick={pickOnTimeline}
              className="relative h-10 w-full touch-manipulation rounded-sm"
            >
              <span className="absolute inset-x-0 top-4 h-2 rounded-full bg-input-background" />
              {targetMs !== null ? (
                <span
                  className="absolute top-4 h-2 rounded-full bg-primary"
                  style={
                    reverse
                      ? { left: 0, width: `${percentOf(targetMs)}%` }
                      : { left: `${percentOf(targetMs)}%`, right: 0 }
                  }
                />
              ) : null}
              {frames.keyframesMs.map((frame) => (
                <span
                  key={frame}
                  className="absolute top-3 h-4 w-px bg-muted-foreground/70"
                  style={{ left: `${percentOf(frame)}%` }}
                />
              ))}
              {reference !== undefined ? (
                <span
                  className="absolute top-2 h-6 w-0.5 bg-warning"
                  style={{ left: `${percentOf(reference)}%` }}
                  title="停下处"
                />
              ) : null}
              {targetMs !== null ? (
                <span
                  className="absolute top-0 flex -translate-x-1/2 items-center gap-0.5 font-mono text-mono-sm tabular-nums text-primary"
                  style={{ left: `${percentOf(targetMs)}%` }}
                >
                  {reverse ? <ArrowLeft className="h-3 w-3" aria-hidden /> : null}
                  <span className="h-3 w-1 rounded-full bg-primary" />
                  {reverse ? null : <ArrowRight className="h-3 w-3" aria-hidden />}
                </span>
              ) : null}
            </button>
            <div className="flex justify-between font-mono text-mono-sm tabular-nums text-muted-foreground">
              <span>{formatFrame(0)}</span>
              {reference !== undefined ? <span className="text-warning">停下处 {formatFrame(reference)}</span> : null}
              <span>{formatFrame(totalMs)}</span>
            </div>
          </div>
        ) : null}

        <div role="radiogroup" aria-label="接入点" className="flex flex-col gap-1">
          <ChoiceRow
            label={reference !== undefined ? "从停下处继续" : "就近接入"}
            meta={outcomeMeta(nearest)}
            selected={selected === "nearest"}
            isDefault={defaultChoice.kind === "nearest"}
            failed={!nearest.ok}
            onSelect={() => setSelected("nearest")}
          />
          <ChoiceRow
            label={reverse ? "从末尾开始" : "从头开始"}
            meta={outcomeMeta(boundary)}
            selected={selected === "boundary"}
            isDefault={defaultChoice.kind === "boundary"}
            failed={!boundary.ok}
            onSelect={() => setSelected("boundary")}
          />
          <ChoiceRow
            label="指定位置"
            meta={outcomeMeta(specified)}
            hint={specifiedHint}
            selected={selected === "frame"}
            isDefault={defaultChoice.kind === "frame"}
            failed={!specified.ok}
            onSelect={() => setSelected("frame")}
          />
          {selected === "frame" && frames ? (
            <div className="flex items-center justify-end gap-2 px-1">
              <button
                type="button"
                aria-label={forced ? "提前 0.1 秒" : "上一关键帧"}
                onClick={() => step(-1)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-input-background text-foreground hover:bg-accent"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <span
                data-testid="entry-specified-frame"
                className="min-w-20 text-center font-mono text-mono-md tabular-nums text-foreground"
              >
                {formatFrame(frameMs)}
              </span>
              <button
                type="button"
                aria-label={forced ? "推后 0.1 秒" : "下一关键帧"}
                onClick={() => step(1)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-input-background text-foreground hover:bg-accent"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>

        {outcome.ok ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <SummaryTile
                label="先移动到位"
                testId="entry-transition-time"
                value={moving ? formatSeconds(outcome.transitionSeconds) : "无需移动"}
              />
              <SummaryTile
                label="再运行动作"
                testId="entry-run-time"
                value={formatSeconds(outcome.runSeconds)}
                caption={
                  outcome.skippedSeconds > 0.05
                    ? `跳过${runWord} ${formatSeconds(outcome.skippedSeconds)}`
                    : "完整动作"
                }
              />
              <SummaryTile
                label="共计"
                testId="entry-total-time"
                value={formatSeconds(outcome.totalSeconds)}
                emphasis
                {...(outcome.plan.loopCount === 0 ? { caption: "之后循环" } : {})}
              />
            </div>
            {consequence ? <p className="text-body-sm text-muted-foreground">{consequence}</p> : null}
          </>
        ) : null}

        {!outcome.ok ? (
          <div role="alert" className="flex flex-col gap-1">
            <p className="text-body-sm text-destructive">{`这个接入点用不了：${outcome.message}`}</p>
            <p className="font-mono text-mono-sm text-muted-foreground">原因：{outcome.detail}</p>
          </div>
        ) : null}
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel type="button">取消</AlertDialogCancel>
        <button
          type="button"
          className="h-10 rounded-md bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50"
          disabled={!outcome.ok}
          onClick={() => {
            if (outcome.ok) onConfirm(outcome.plan);
          }}
        >
          {outcome.ok
            ? `${chained ? "开始运行" : "确认"}，从 ${formatFrame(outcome.plan.targetFrameMs)}开始`
            : "确认"}
        </button>
      </AlertDialogFooter>
    </>
  );
};

/**
 * 准备前的接入点选择：不在运行方向的起点、要从曲线中间开始或算不出方案时弹出。
 * 默认按推子槽的就近开关（继续 / 反向回为从停下处继续），可以改选从头开始或指定位置，
 * 只对这一次有效。设备位置在打开时冻结；确认前由调用方核对是否变了。
 */
export const StartEntryDialog = ({ request, onCancel, onConfirm }: StartEntryDialogProps) => (
  <AlertDialog
    open={request !== null}
    onOpenChange={(next) => {
      if (!next) onCancel();
    }}
  >
    <AlertDialogContent className="gap-3 border-0 bg-card shadow-[0_4px_24px_rgba(0,0,0,0.4)] sm:max-w-xl">
      {request ? <StartEntryBody request={request} onConfirm={onConfirm} /> : null}
    </AlertDialogContent>
  </AlertDialog>
);
