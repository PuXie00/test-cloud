import { useCallback, useMemo, useState } from "react";
import { useProject } from "@/app/project/use-project";
import { hydrateSetupFromDocument } from "@/app/project/setup-hydrate";
import type { ProjectDocument } from "@/app/project/project-document-types";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { StepAddObjects } from "./steps/step-add-objects";
import { StepAddPlc } from "./steps/step-add-plc";
import { StepBindAxes } from "./steps/step-bind-axes";
import { StepIntro } from "./steps/step-intro";
import { StepReview } from "./steps/step-review";
import { WizardFooter } from "./wizard-footer";
import { resolveInitialWizardView, type WizardSetup, type WizardView } from "./wizard-state";
import { WizardStepNav } from "./wizard-step-nav";
import { WizardTopologyStrip } from "./wizard-topology-strip";
import { readStoredWizardView, writeStoredWizardView } from "./wizard-view-storage";

type ConfigWizardBodyProps = {
  projectId: string | null;
  document: ProjectDocument | null;
};

const ConfigWizardBody = ({ projectId, document }: ConfigWizardBodyProps) => {
  const { objects, plcs, motors } = useProjectStore();
  const setup = useMemo<WizardSetup>(() => ({ objects, plcs, motors }), [motors, objects, plcs]);
  // 切换工程时 store 要等 effect 才换数据，这里直接读工程文档，不会拿上一个工程的内容来判断
  const [view, setView] = useState<WizardView>(() =>
    resolveInitialWizardView(
      projectId ? readStoredWizardView(projectId) : null,
      document ? hydrateSetupFromDocument(document.setup) : setup,
    ),
  );

  const navigate = useCallback(
    (next: WizardView) => {
      setView(next);
      if (projectId) writeStoredWizardView(projectId, next);
    },
    [projectId],
  );

  const renderStep = () => {
    switch (view) {
      case "intro":
        return <StepIntro setup={setup} onNavigate={navigate} />;
      case "objects":
        return <StepAddObjects />;
      case "hardware":
        return <StepAddPlc />;
      case "binding":
        return <StepBindAxes />;
      case "review":
        return <StepReview onNavigate={navigate} />;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WizardStepNav view={view} setup={setup} onNavigate={navigate} />
      <WizardTopologyStrip view={view} setup={setup} />
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-background p-4">
        {renderStep()}
      </div>
      <WizardFooter view={view} setup={setup} onNavigate={navigate} />
    </div>
  );
};

export const ConfigWizardPanel = () => {
  const { currentProject } = useProject();
  const projectId = currentProject?.id ?? null;
  return (
    <ConfigWizardBody
      key={projectId ?? "no-project"}
      projectId={projectId}
      document={currentProject?.document ?? null}
    />
  );
};
