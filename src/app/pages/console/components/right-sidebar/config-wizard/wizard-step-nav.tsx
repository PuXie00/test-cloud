import { Check, Circle, FastForward, Play } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";
import { WIZARD_STEPS } from "./config-wizard-constants";
import type { WizardStepKey, WizardStepState } from "./config-wizard-types";

const StepIcon = ({ state }: { state: WizardStepState }) => {
  if (state === "current") return <Play className="h-4 w-4 shrink-0" aria-hidden />;
  if (state === "done") return <Check className="h-4 w-4 shrink-0" aria-hidden />;
  if (state === "skipped") return <FastForward className="h-4 w-4 shrink-0" aria-hidden />;
  return <Circle className="h-4 w-4 shrink-0 opacity-45" aria-hidden />;
};

export const WizardStepNav = () => {
  const { meta, getStepState, canNavigateTo, setCurrentStep } = useConfigWizard();

  return (
    <nav
      className="custom-scrollbar flex w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border/40 bg-card py-2"
      aria-label="配置向导步骤"
    >
      {WIZARD_STEPS.map((step, index) => {
        const state = getStepState(step.key);
        const clickable = canNavigateTo(step.key);
        const isCurrent = meta.currentStep === step.key;

        return (
          <button
            key={step.key}
            type="button"
            disabled={!clickable}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => setCurrentStep(step.key as WizardStepKey)}
            className={cn(
              "flex min-h-10 w-full items-start gap-2 border-l-2 px-3 py-2.5 text-left transition-colors",
              "[@media(pointer:coarse)]:min-h-11",
              isCurrent && "border-primary bg-accent/40 text-primary",
              state === "done" && !isCurrent && "border-show text-show hover:bg-accent",
              state === "skipped" && !isCurrent && "border-dashed border-border text-muted-foreground hover:bg-accent",
              state === "pending" && "border-transparent text-muted-foreground/45",
              clickable && state !== "pending" && !isCurrent && "hover:bg-accent hover:text-foreground",
              !clickable && "cursor-not-allowed opacity-50"
            )}
          >
            <StepIcon state={state} />
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm leading-tight">{step.label}</span>
              {step.skippable && (
                <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-muted-foreground">
                  可跳过
                </span>
              )}
            </span>
            <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">{index + 1}</span>
          </button>
        );
      })}
    </nav>
  );
};
