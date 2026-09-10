import { useConfigWizard } from "@/app/pages/console/hooks/use-config-wizard";
import { WIZARD_STEPS } from "./config-wizard-constants";
import { WizardFooter } from "./wizard-footer";
import { WizardSkipBanner } from "./wizard-skip-banner";
import { WizardStepNav } from "./wizard-step-nav";
import { StepAddObjects } from "./steps/step-add-objects";
import { StepAddPlc } from "./steps/step-add-plc";
import { StepBindAxes } from "./steps/step-bind-axes";
import { StepReview } from "./steps/step-review";

const SkippedStepPlaceholder = ({ label }: { label: string }) => (
  <div className="flex min-h-[200px] items-center justify-center rounded-md bg-warning-surface/30 p-6 text-center text-body-sm text-muted-foreground">
    此步骤已跳过，仅支持离线仿真。点击左侧「{label}」可重新配置。
  </div>
);

export const ConfigWizardPanel = () => {
  const { meta, isCurrentStepSkipped } = useConfigWizard();
  const stepDef = WIZARD_STEPS.find((step) => step.key === meta.currentStep);
  const stepIndex = WIZARD_STEPS.findIndex((step) => step.key === meta.currentStep);

  const renderStep = () => {
    if (isCurrentStepSkipped()) {
      return <SkippedStepPlaceholder label={stepDef?.label ?? ""} />;
    }
    switch (meta.currentStep) {
      case "objects":
        return <StepAddObjects />;
      case "hardware":
        return <StepAddPlc />;
      case "binding":
        return <StepBindAxes />;
      case "review":
        return <StepReview />;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-between bg-muted px-4">
        <span className="text-heading-md font-semibold text-foreground">配置向导</span>
        <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
          步骤 {stepIndex + 1}/{WIZARD_STEPS.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WizardStepNav />
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-background p-4">
          {renderStep()}
        </div>
      </div>
      <WizardSkipBanner />
      <WizardFooter />
    </div>
  );
};
