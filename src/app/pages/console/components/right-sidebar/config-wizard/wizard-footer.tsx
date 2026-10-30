import { ArrowLeft, ArrowRight } from "lucide-react";
import { usePermissions } from "@/app/auth/permissions";
import { useConsoleNav } from "@/app/pages/console/hooks/use-console-nav";
import { WIZARD_STEPS } from "./config-wizard-constants";
import { wizardBtnPrimary, wizardBtnSecondary } from "./wizard-buttons";
import { getNextWizardStep, type WizardSetup, type WizardView } from "./wizard-state";
import { useWizardCapabilities } from "./use-wizard-capabilities";

const FOOTER_CLASS = "flex min-h-[52px] shrink-0 items-center justify-between gap-3 bg-muted px-4 py-2";

const stepLabel = (view: WizardView) =>
  WIZARD_STEPS.find((step) => step.key === view)?.label ?? "";

const ReviewFooter = ({ onNavigate }: { onNavigate: (view: WizardView) => void }) => {
  const { navigate } = useConsoleNav();
  const { can } = usePermissions();
  const capabilities = useWizardCapabilities();
  const isReady = (id: (typeof capabilities)[number]["id"]) =>
    capabilities.find((item) => item.id === id)?.state === "ready";

  const primary =
    isReady("debug") && can("build.debug")
      ? { label: "去调试", onClick: () => navigate("devices", { devicesTab: "debug" }) }
      : isReady("preview") && can("action.view")
        ? { label: "去编排动作", onClick: () => navigate("sequences") }
        : { label: "去工程结构", onClick: () => navigate("devices", { devicesTab: "structure" }) };

  return (
    <div className={FOOTER_CLASS}>
      <button type="button" className={wizardBtnSecondary} onClick={() => onNavigate("binding")}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        上一步
      </button>
      <button type="button" className={wizardBtnPrimary} onClick={primary.onClick}>
        {primary.label}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
};

type WizardFooterProps = {
  view: WizardView;
  setup: WizardSetup;
  onNavigate: (view: WizardView) => void;
};

/** 下一步不设门槛：哪一步都可以先放着，检查页会说清楚还差什么 */
export const WizardFooter = ({ view, setup, onNavigate }: WizardFooterProps) => {
  const { navigate } = useConsoleNav();

  if (view === "review") return <ReviewFooter onNavigate={onNavigate} />;

  if (view === "intro") {
    const next = getNextWizardStep(setup);
    const untouched = next === "objects" && setup.objects.length === 0;
    return (
      <div className={FOOTER_CLASS}>
        <button
          type="button"
          className={wizardBtnSecondary}
          onClick={() => navigate("devices", { devicesTab: "structure" })}
        >
          我熟悉了，去工程结构
        </button>
        <button type="button" className={wizardBtnPrimary} onClick={() => onNavigate(next)}>
          {untouched ? "开始搭建" : `继续：${stepLabel(next)}`}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  const index = WIZARD_STEPS.findIndex((step) => step.key === view);
  const previous: WizardView = WIZARD_STEPS[index - 1]?.key ?? "intro";
  const next = WIZARD_STEPS[index + 1]!;

  return (
    <div className={FOOTER_CLASS}>
      <button type="button" className={wizardBtnSecondary} onClick={() => onNavigate(previous)}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        上一步
      </button>
      <button type="button" className={wizardBtnPrimary} onClick={() => onNavigate(next.key)}>
        下一步：{next.label}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
};
