import { useState } from "react";
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
import { cn } from "@/app/components/ui/utils";

type ChoiceActionId = "enable" | "couple";
type SimpleActionId = "home" | "level" | "reset" | "clearAlarm";
type MainActionId = ChoiceActionId | SimpleActionId;

type StatusControlBarProps = {
  objectLabel: string;
  objectSummary: string;
  status: string;
  objectStatus: ControlledObjectStatus;
  coupleBusy?: boolean;
  onCoupleChoice?: (coupleFlag: 0 | 1) => void;
  onEnableChoice?: (enableFlag: 0 | 1) => void;
  onReset?: () => void;
  onHome?: () => void;
};

const MAIN_ACTIONS: { id: MainActionId; label: string; tone: "primary" | "show" | "warning" | "default" }[] = [
  { id: "couple", label: "耦合", tone: "primary" },
  { id: "enable", label: "使能", tone: "primary" },
  { id: "reset", label: "复位", tone: "warning" },
  { id: "home", label: "回原", tone: "default" },
  { id: "level", label: "走平", tone: "default" },
];

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

const SIMPLE_DIALOG: Record<SimpleActionId, { title: string; confirm: string }> = {
  home: { title: "回原", confirm: "确认回原" },
  level: { title: "走平", confirm: "确认走平" },
  reset: { title: "复位", confirm: "确认复位" },
  clearAlarm: { title: "清除报警", confirm: "确认清除" },
};

const isChoiceAction = (id: MainActionId): id is ChoiceActionId =>
  id === "enable" || id === "couple";

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
  status,
  objectStatus,
  coupleBusy = false,
  onCoupleChoice,
  onEnableChoice,
  onReset,
  onHome,
}: StatusControlBarProps) => {
  const [pending, setPending] = useState<MainActionId | null>(null);

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

  const choice = pending && isChoiceAction(pending) ? CHOICE_DIALOG[pending] : null;
  const simple = pending && !isChoiceAction(pending) ? SIMPLE_DIALOG[pending] : null;
  const title = choice?.title ?? simple?.title ?? "";
  const confirmTone = pending === "reset" || pending === "clearAlarm" ? "warning" : "primary";

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-heading-md text-foreground">{objectLabel}</h2>
        <ObjectStatusBadge status={objectStatus}>{status}</ObjectStatusBadge>
      </div>

      <div className=" rounded-md overflow-hidden">
        <div className="px-3 h-9 flex items-center bg-muted">
          主操作
        </div>
        <div className="bg-background p-3 ">
          <div className="grid grid-cols-2 gap-2">
            {MAIN_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.id === "couple" && coupleBusy}
                onClick={() => setPending(action.id)}
                className={cn(actionButtonClassName, TONE_CLASS[action.tone], action.id === "couple" && coupleBusy && "opacity-40")}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      

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
