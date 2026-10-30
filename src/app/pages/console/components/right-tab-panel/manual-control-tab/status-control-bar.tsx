import { useState } from "react";
import { Layers } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { ObjectStatusBadge } from "../../monitor-grid/object-status-badge";
import type { ControlledObjectStatus } from "../../monitor-grid/monitor-data";
import type { PermissionId } from "@shared/auth/permissions";
import { usePermissions } from "@/app/auth/permissions";
import { cn } from "@/app/components/ui/utils";
import { NO_SELECTION_NOTICE, type ManualOperation } from "./manual-control-availability";

type ChoiceActionId = "enable" | "couple";
type DialogActionId = "home" | "level" | "reset" | "clearAlarm";
type ImmediateActionId = "allStop" | "stop";
type MainActionId = ChoiceActionId | DialogActionId | ImmediateActionId;

type StatusControlBarProps = {
  /** null：未选物体，头部显示「请先选择受控物体」 */
  objectLabel: string | null;
  objectSummary: string;
  /** 所选物体的名称；多于 1 个时头部显示「批量操作中（数量）」 */
  batchNames?: readonly string[];
  status: string;
  objectStatus: ControlledObjectStatus;
  /** 物体状态不满足时的原因（如离线） */
  notice?: string | null;
  allowed: (operation: ManualOperation) => boolean;
  coupleBusy?: boolean;
  onCoupleChoice?: (coupleFlag: 0 | 1) => void;
  onEnableChoice?: (enableFlag: 0 | 1) => void;
  onReset?: () => void;
  onHome?: () => void;
  onStop?: () => void;
  onAllStop?: () => void;
};

const MAIN_ACTIONS: {
  id: Extract<MainActionId, ManualOperation>;
  label: string;
  tone: "primary" | "show" | "warning" | "default";
}[] = [
  { id: "couple", label: "耦合", tone: "primary" },
  { id: "enable", label: "使能", tone: "primary" },
  { id: "reset", label: "复位", tone: "warning" },
  { id: "allStop", label: "总停止", tone: "default" },
  { id: "stop", label: "停止", tone: "default" },
  { id: "home", label: "回原", tone: "default" },
  { id: "level", label: "走平", tone: "default" },
];

/** 主操作按钮对应的权限：没有就不显示 */
const ACTION_PERMISSION: Record<MainActionId, PermissionId> = {
  couple: "control.couple",
  enable: "control.device",
  reset: "control.device",
  clearAlarm: "control.device",
  allStop: "control.device",
  stop: "control.device",
  home: "control.manual",
  level: "control.manual",
};

const CHOICE_DIALOG: Record<
  ChoiceActionId,
  { title: string; choices: [{ id: string; label: string }, { id: string; label: string }] }
> = {
  enable: {
    title: "使能",
    choices: [
      { id: "off", label: "断能" },
      { id: "on", label: "使能" },
    ],
  },
  couple: {
    title: "耦合",
    choices: [
      { id: "off", label: "解耦" },
      { id: "on", label: "耦合" },
    ],
  },
};

const SIMPLE_DIALOG: Record<DialogActionId, { title: string; confirm: string }> = {
  home: { title: "回原", confirm: "确认回原" },
  level: { title: "走平", confirm: "确认走平" },
  reset: { title: "复位", confirm: "确认复位" },
  clearAlarm: { title: "清除报警", confirm: "确认清除" },
};

const isChoiceAction = (id: MainActionId): id is ChoiceActionId =>
  id === "enable" || id === "couple";

const isDialogAction = (id: MainActionId): id is DialogActionId =>
  id === "home" || id === "level" || id === "reset" || id === "clearAlarm";

const TONE_CLASS: Record<"primary" | "show" | "warning" | "default", string> = {
  primary: "bg-primary text-primary-foreground",
  show: "bg-show text-background",
  warning: "bg-warning text-background",
  default: "bg-foreground text-background",
};

const actionButtonClassName =
  "h-10 rounded-sm text-body-sm font-semibold";

export const StatusControlBar = ({
  objectLabel,
  objectSummary,
  batchNames = [],
  status,
  objectStatus,
  notice = null,
  allowed,
  coupleBusy = false,
  onCoupleChoice,
  onEnableChoice,
  onReset,
  onHome,
  onStop,
  onAllStop,
}: StatusControlBarProps) => {
  const [pending, setPending] = useState<MainActionId | null>(null);
  const { can } = usePermissions();
  const visibleActions = MAIN_ACTIONS.filter((action) => can(ACTION_PERMISSION[action.id]));

  const handleOpenChange = (open: boolean) => {
    if (!open) setPending(null);
  };

  const handleConfirm = () => {
    setPending(null);
  };

  const handleCoupleChoice = (coupleFlag: 0 | 1) => {
    setPending(null);
    onCoupleChoice?.(coupleFlag);
  };

  const handleActionClick = (id: MainActionId) => {
    if (id === "stop") {
      onStop?.();
      return;
    }
    if (id === "allStop") {
      onAllStop?.();
      return;
    }
    setPending(id);
  };

  const choice = pending && isChoiceAction(pending) ? CHOICE_DIALOG[pending] : null;
  const simple = pending && isDialogAction(pending) ? SIMPLE_DIALOG[pending] : null;
  const title = choice?.title ?? simple?.title ?? "";
  const confirmTone = pending === "reset" || pending === "clearAlarm" ? "warning" : "primary";
  const batchCount = batchNames.length;
  const batchText = batchNames.join("、");

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        {objectLabel === null ? (
          <h2 className="min-w-0 flex-1 truncate text-heading-md text-muted-foreground">
            {NO_SELECTION_NOTICE}
          </h2>
        ) : batchCount > 1 ? (
          <div className="min-w-0 flex-1 rounded-md border border-primary/60 bg-primary/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <h2 className="min-w-0 flex-1 truncate text-heading-md font-semibold text-primary">
                {`批量操作中（${batchCount}）`}
              </h2>
              <ObjectStatusBadge status={objectStatus}>{status}</ObjectStatusBadge>
            </div>
            <p className="mt-1 truncate text-body-sm text-muted-foreground" title={batchText}>
              {batchText}
            </p>
          </div>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 truncate text-heading-md text-foreground">{objectLabel}</h2>
            <ObjectStatusBadge status={objectStatus}>{status}</ObjectStatusBadge>
          </>
        )}
      </div>
      {notice ? <p className="text-body-sm text-warning">{notice}</p> : null}

      {visibleActions.length > 0 && (
      <div className=" rounded-md overflow-hidden">
        <div className="px-3 h-9 flex items-center bg-muted">
          主操作
        </div>
        <div className="bg-background p-3 ">
          <div className="grid grid-cols-2 gap-2">
            {visibleActions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={!allowed(action.id) || (action.id === "couple" && coupleBusy)}
                onClick={() => handleActionClick(action.id)}
                className={cn(
                  actionButtonClassName,
                  TONE_CLASS[action.tone],
                  "disabled:pointer-events-none disabled:opacity-40",
                )}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {title} · {objectLabel}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-body-sm text-muted-foreground">
              {objectSummary}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {choice
              ? choice.choices.map((item, index) => (
                  <AlertDialogAction
                    key={item.id}
                    onClick={() => {
                      if (pending === "couple") {
                        handleCoupleChoice(item.id === "on" ? 1 : 0);
                        return;
                      }
                      if (pending === "enable") {
                        setPending(null);
                        onEnableChoice?.(item.id === "on" ? 1 : 0);
                        return;
                      }
                      handleConfirm();
                    }}
                    className={
                      index === 0
                        ? "border border-border bg-transparent text-foreground hover:bg-accent"
                        : TONE_CLASS[confirmTone]
                    }
                  >
                    {item.label}
                  </AlertDialogAction>
                ))
              : (
                  <AlertDialogAction
                    onClick={() => {
                      if (pending === "reset") onReset?.();
                      if (pending === "home") onHome?.();
                      setPending(null);
                    }}
                    className={TONE_CLASS[confirmTone]}
                  >
                    {simple?.confirm}
                  </AlertDialogAction>
                )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
