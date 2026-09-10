import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { cn } from "@/app/components/ui/utils";
import { SKIPPABLE_STEPS, WIZARD_STEPS } from "./config-wizard-constants";
import {
  getReviewIssues,
  hasBlockingReviewIssues,
} from "./wizard-state";

const btnSecondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-transparent px-3 text-body-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-[44px]";
const btnPrimary =
  "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11";

export const WizardFooter = () => {
  const { meta, goNext, goPrev, requestSkip, completeWizard, isCurrentStepSkipped } =
    useConfigWizard();
  const { objects, plcs, motors } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();

  const stepIndex = WIZARD_STEPS.findIndex((step) => step.key === meta.currentStep);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === WIZARD_STEPS.length - 1;
  const progress = ((stepIndex + 1) / WIZARD_STEPS.length) * 100;
  const canSkip = SKIPPABLE_STEPS.has(meta.currentStep) && !meta.skippedSteps.includes(meta.currentStep);
  const skipped = isCurrentStepSkipped();

  const reviewIssues = getReviewIssues(
    { objects, plcs, motors, simulationOnly: meta.simulationOnly },
    { getPlcRuntime },
  );
  const hasBlocking = hasBlockingReviewIssues(reviewIssues);

  const handlePrimary = () => {
    if (isLast) {
      completeWizard();
      return;
    }
    goNext();
  };

  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 bg-muted px-4">
      <div className="flex items-center gap-2">
        <button type="button" className={btnSecondary} disabled={isFirst} onClick={goPrev}>
          ← 上一步
        </button>
        {canSkip && !skipped && (
          <button type="button" className={btnSecondary} onClick={requestSkip}>
            ⏭ 跳过此步骤
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1.5 w-[120px] overflow-hidden rounded-full bg-input-background">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
          {stepIndex + 1}/{WIZARD_STEPS.length}
        </span>
      </div>

      <button
        type="button"
        className={cn(btnPrimary)}
        disabled={isLast && hasBlocking}
        onClick={handlePrimary}
      >
        {isLast ? "✓ 完成配置" : "完成并继续 →"}
      </button>
    </div>
  );
};
