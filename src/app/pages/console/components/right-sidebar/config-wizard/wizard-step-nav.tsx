import { Check } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { WIZARD_STEPS } from "./config-wizard-constants";
import {
  getWizardStepProgress,
  type WizardSetup,
  type WizardStepProgress,
  type WizardView,
} from "./wizard-state";

const PROGRESS_LABEL: Record<WizardStepProgress, string> = {
  empty: "未开始",
  partial: "未完成",
  done: "已完成",
};

type WizardStepNavProps = {
  view: WizardView;
  setup: WizardSetup;
  onNavigate: (view: WizardView) => void;
};

const itemClass = (active: boolean) =>
  cn(
    "flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 text-body-sm transition-colors",
    "[@media(pointer:coarse)]:min-h-11",
    active
      ? "border-primary text-primary"
      : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  );

/** 顶部步骤条：所有步骤都能随时进入，图标只表示工程数据的进度 */
export const WizardStepNav = ({ view, setup, onNavigate }: WizardStepNavProps) => (
  <nav className="flex shrink-0 bg-muted px-2" aria-label="配置向导步骤">
    <button
      type="button"
      aria-current={view === "intro" ? "step" : undefined}
      onClick={() => onNavigate("intro")}
      className={itemClass(view === "intro")}
    >
      <span className="truncate">认识搭建</span>
    </button>
    {WIZARD_STEPS.map((step, index) => {
      const progress = getWizardStepProgress(step.key, setup);
      const active = view === step.key;
      return (
        <button
          key={step.key}
          type="button"
          aria-current={active ? "step" : undefined}
          aria-label={`${step.label}，${PROGRESS_LABEL[progress]}`}
          onClick={() => onNavigate(step.key)}
          className={itemClass(active)}
        >
          {progress === "done" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-show" aria-hidden />
          ) : (
            <span
              className={cn(
                "shrink-0 font-mono text-mono-sm tabular-nums",
                progress === "partial" && "text-warning",
              )}
              aria-hidden
            >
              {index + 1}
            </span>
          )}
          <span className="truncate">{step.label}</span>
        </button>
      );
    })}
  </nav>
);
