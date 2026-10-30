import { Box, Cpu, Link2, type LucideIcon } from "lucide-react";
import type { WizardStepKey } from "../config-wizard-types";
import { WizardStepHeading } from "../wizard-step-heading";
import { getWizardCounts, type WizardSetup, type WizardView } from "../wizard-state";

type IntroCard = {
  step: WizardStepKey;
  icon: LucideIcon;
  scope: string;
  question: string;
  answer: string;
  status: string | null;
};

type StepIntroProps = {
  setup: WizardSetup;
  onNavigate: (view: WizardView) => void;
};

export const StepIntro = ({ setup, onNavigate }: StepIntroProps) => {
  const counts = getWizardCounts(setup);
  const cards: IntroCard[] = [
    {
      step: "objects",
      icon: Box,
      scope: "软件里，可离线",
      question: "动什么",
      answer: "受控物体，以及牵引它的吊点",
      status: counts.objects > 0 ? `已有 ${counts.objects} 个物体` : null,
    },
    {
      step: "hardware",
      icon: Cpu,
      scope: "现场设备",
      question: "谁来驱动",
      answer: "主控，以及它带的驱动单元",
      status: counts.plcs > 0 ? `${counts.plcs} 个主控，${counts.motors} 台驱动单元` : null,
    },
    {
      step: "binding",
      icon: Link2,
      scope: "两边对应",
      question: "怎么对应",
      answer: "把每个吊点交给一台驱动单元",
      status: counts.axes > 0 ? `${counts.boundAxes}/${counts.axes} 个吊点已绑定` : null,
    },
  ];

  return (
    <div className="space-y-4">
      <WizardStepHeading
        title="搭建就是回答三个问题"
        description="先在 3D 里描述要动的东西，再告诉软件现场用什么设备驱动它，最后把两边对应起来。"
      />
      <div className="grid grid-cols-3 gap-2">
        {cards.map(({ step, icon: Icon, scope, question, answer, status }) => (
          <button
            key={step}
            type="button"
            onClick={() => onNavigate(step)}
            className="flex min-w-0 flex-col items-start gap-1 rounded-md bg-muted p-3 text-left hover:bg-accent"
          >
            <span className="text-label-caps text-muted-foreground">{scope}</span>
            <span className="flex items-center gap-1.5 text-heading-md font-semibold text-foreground">
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              {question}
            </span>
            <span className="text-body-sm text-muted-foreground">{answer}</span>
            <span className="mt-1 text-body-sm text-foreground">{status ?? "还没有"}</span>
          </button>
        ))}
      </div>
      <p className="text-body-sm text-muted-foreground">
        没有设备也能完成第一个问题，并继续编排动作。这里添加的内容和「工程结构」是同一份数据，之后随时可以改。
      </p>
    </div>
  );
};
