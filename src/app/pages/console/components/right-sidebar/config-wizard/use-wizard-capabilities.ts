import { useMemo } from "react";
import { useAlignmentChecklist } from "@/app/pages/console/components/drive-debug/alignment-checklist/alignment-checklist-provider";
import { usePlcRuntime } from "@/app/pages/console/hooks/plc-runtime-provider";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { getWizardCapabilities } from "./wizard-state";

export const useWizardCapabilities = () => {
  const { objects, plcs, motors } = useProjectStore();
  const { getPlcRuntime } = usePlcRuntime();
  const { allConfirmed } = useAlignmentChecklist();
  return useMemo(
    () =>
      getWizardCapabilities(
        { objects, plcs, motors },
        { getPlcRuntime },
        { alignmentConfirmed: allConfirmed },
      ),
    [allConfirmed, getPlcRuntime, motors, objects, plcs],
  );
};
